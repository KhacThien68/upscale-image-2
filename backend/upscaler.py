import threading
import cv2
import torch
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer
from realesrgan.archs.srvgg_arch import SRVGGNetCompact  # noqa: F401


class JobCancelled(Exception):
    pass


MODELS_DIR = Path(__file__).parent / "models"
MODELS_DIR.mkdir(exist_ok=True)

USE_GPU = torch.cuda.is_available()
HALF = USE_GPU


def _auto_tile_size() -> int:
    if not USE_GPU:
        return 256
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024 ** 3
    if vram_gb >= 10:
        return 768
    if vram_gb >= 6:
        return 512
    if vram_gb >= 4:
        return 384
    return 256


TILE_SIZE = _auto_tile_size()

MODEL_CONFIGS = {
    "realesrgan-x4plus": {
        "filename": "RealESRGAN_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth",
        "arch": "rrdbnet",
        "num_block": 23,
        "num_feat": 64,
    },
    "realesrgan-x4plus-anime": {
        "filename": "RealESRGAN_x4plus_anime_6B.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth",
        "arch": "rrdbnet",
        "num_block": 6,
        "num_feat": 64,
    },
    "realesrnet-x4plus": {
        "filename": "RealESRNet_x4plus.pth",
        "url": "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.1/RealESRNet_x4plus.pth",
        "arch": "rrdbnet",
        "num_block": 23,
        "num_feat": 64,
    },
}

GFPGAN_URL = "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.4/GFPGANv1.4.pth"
GFPGAN_FILE = "GFPGANv1.4.pth"

_upscaler_cache: dict = {}
_gfpgan_cache = None


def _download(url, dest, label):
    def reporthook(count, block, total):
        pct = min(count * block * 100 // total, 100)
        print(f'\r  {pct}%', end='', flush=True)
    print(f'Downloading {label}...')
    urllib.request.urlretrieve(url, dest, reporthook)


def _get_upscaler(model_name: str) -> RealESRGANer:
    if model_name in _upscaler_cache:
        return _upscaler_cache[model_name]

    cfg = MODEL_CONFIGS[model_name]
    model_path = MODELS_DIR / cfg['filename']

    if not model_path.exists():
        _download(cfg['url'], str(model_path), cfg['filename'])

    model = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=cfg['num_feat'],
        num_block=cfg['num_block'],
        num_grow_ch=32,
        scale=4,
    )

    upscaler = RealESRGANer(
        scale=4,
        model_path=str(model_path),
        model=model,
        tile=TILE_SIZE,
        tile_pad=10,
        pre_pad=0,
        half=HALF,
        gpu_id=0 if USE_GPU else None,
    )

    print(f'Model loaded: {model_name} ({"GPU fp16" if HALF else "CPU"}) | tile={TILE_SIZE}')

    _upscaler_cache[model_name] = upscaler
    return upscaler


def _get_face_enhancer():
    global _gfpgan_cache
    if _gfpgan_cache is not None:
        return _gfpgan_cache

    from gfpgan import GFPGANer

    gfpgan_path = MODELS_DIR / GFPGAN_FILE
    if not gfpgan_path.exists():
        _download(GFPGAN_URL, str(gfpgan_path), 'GFPGANv1.4.pth')

    enhancer = GFPGANer(
        model_path=str(gfpgan_path),
        upscale=1,
        arch='clean',
        channel_multiplier=2,
        bg_upsampler=None,
    )

    _gfpgan_cache = enhancer
    print('GFPGAN loaded')
    return enhancer


def process_image(
    input_path: str,
    output_path: str,
    model_name: str,
    scale: int,
    face_enhance: bool,
    progress_cb: Callable[[int, str], None],
    cancel_event: threading.Event,
    target_edge: int = 0,
):
    def check_cancel():
        if cancel_event.is_set():
            raise JobCancelled('Job bị hủy bởi người dùng')

    progress_cb(15, 'Đang đọc ảnh...')
    img = cv2.imread(input_path, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError('Không đọc được file ảnh: ' + input_path)

    h, w = img.shape[:2]
    outscale = float(scale)
    skip_upscale = False

    if target_edge > 0:
        max_side = max(h, w)
        outscale = float(target_edge) / max_side
        out_w = round(w * outscale)
        out_h = round(h * outscale)
        if outscale < 1.0:
            # Target nhỏ hơn ảnh gốc — chỉ resize xuống, không chạy AI upscale
            progress_cb(40, f'Resize {w}×{h} → {out_w}×{out_h} (bỏ qua upscale)...')
            img = cv2.resize(img, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
            skip_upscale = True

    check_cancel()

    if skip_upscale:
        output = img
        progress_cb(75, 'Bỏ qua AI upscale (kích thước đích nhỏ hơn ảnh gốc)...')
    else:
        progress_cb(5, 'Đang tải model AI...')
        upscaler = _get_upscaler(model_name)
        check_cancel()

        progress_cb(20, f'Upscaling {w}×{h}...')
        try:
            with torch.no_grad():
                output, _ = upscaler.enhance(img, outscale=outscale)
        except RuntimeError as e:
            if 'CUDA out of memory' in str(e):
                raise RuntimeError('GPU hết VRAM! Thử ảnh nhỏ hơn hoặc giảm tile size trong config.')
            raise
        finally:
            if USE_GPU:
                torch.cuda.synchronize()
                torch.cuda.empty_cache()

    if face_enhance:
        check_cancel()
        progress_cb(75, 'Đang kích nét khuôn mặt (GFPGAN)...')
        face_enhancer = _get_face_enhancer()
        with torch.no_grad():
            _, _, output = face_enhancer.enhance(
                output,
                has_aligned=False,
                only_center_face=False,
                paste_back=True,
            )
        if USE_GPU:
            torch.cuda.synchronize()
            torch.cuda.empty_cache()

    if output.ndim == 3 and output.shape[2] == 4:
        output = cv2.cvtColor(output, cv2.COLOR_BGRA2BGR)

    progress_cb(92, 'Đang lưu JPG...')
    cv2.imwrite(output_path, output, [cv2.IMWRITE_JPEG_QUALITY, 95])
