import asyncio
import shutil
import threading
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from upscaler import JobCancelled, process_image

UPLOAD_DIR = Path("uploads")
RESULT_DIR = Path("results")
UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)

jobs: dict[str, dict] = {}
cancel_events: dict[str, threading.Event] = {}
ws_queues: dict[str, list] = {}  # job_id -> list[asyncio.Queue]

app = FastAPI(title="AI Upscaler")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/upscale")
async def upscale(
    file: UploadFile,
    model: str = Form("realesrgan-x4plus"),
    scale: int = Form(4),
    face_enhance: bool = Form(False),
    target_edge: int = Form(0),
):
    job_id = str(uuid.uuid4())

    suffix = Path(file.filename).suffix.lower() if file.filename else ".jpg"
    input_path = UPLOAD_DIR / f"{job_id}{suffix}"
    output_path = RESULT_DIR / f"{job_id}.jpg"

    with open(input_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    cancel_events[job_id] = threading.Event()
    ws_queues[job_id] = []

    jobs[job_id] = {
        "status": "processing",
        "progress": 0,
        "message": "Đang khởi động...",
        "started_at": time.time(),
        "input_path": str(input_path),
        "output_path": str(output_path),
    }

    asyncio.create_task(_run(job_id, input_path, output_path, model, scale, face_enhance, target_edge))

    return {"job_id": job_id}


@app.websocket("/ws/{job_id}")
async def ws_job(websocket: WebSocket, job_id: str):
    await websocket.accept()

    if job_id not in jobs:
        await websocket.send_json({"status": "error", "message": "Job không tìm thấy"})
        await websocket.close()
        return

    job = jobs[job_id]
    if job["status"] in ("done", "error", "cancelled"):
        await websocket.send_json({
            "status": job["status"],
            "progress": job.get("progress", 0),
            "message": job.get("message", ""),
            "elapsed": job.get("elapsed"),
            "result_size": job.get("result_size"),
        })
        await websocket.close()
        return

    queue: asyncio.Queue = asyncio.Queue()
    ws_queues.setdefault(job_id, []).append(queue)

    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=60)
            except asyncio.TimeoutError:
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    break
                continue

            await websocket.send_json(msg)
            if msg.get("status") in ("done", "error", "cancelled"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        queues = ws_queues.get(job_id, [])
        if queue in queues:
            queues.remove(queue)


@app.post("/api/cancel/{job_id}")
async def cancel_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job không tìm thấy")
    if jobs[job_id]["status"] not in ("processing",):
        return {"ok": True, "note": "Không cần hủy"}
    if job_id in cancel_events:
        cancel_events[job_id].set()
    jobs[job_id].update({"status": "cancelled", "progress": 0, "message": "Đang hủy..."})
    return {"ok": True}


async def _run(job_id, input_path, output_path, model, scale, face_enhance, target_edge=0):
    loop = asyncio.get_event_loop()
    cancel_event = cancel_events.get(job_id)

    def _notify(msg: dict):
        """Gửi update tới tất cả WS client đang kết nối (thread-safe)."""
        for q in list(ws_queues.get(job_id, [])):
            loop.call_soon_threadsafe(q.put_nowait, msg)

    def update(progress: int, message: str):
        if job_id in jobs:
            jobs[job_id]["progress"] = progress
            jobs[job_id]["message"] = message
        _notify({"status": "processing", "progress": progress, "message": message})

    try:
        await loop.run_in_executor(
            None,
            process_image,
            str(input_path),
            str(output_path),
            model,
            scale,
            face_enhance,
            update,
            cancel_event,
            target_edge,
        )
        elapsed = time.time() - jobs[job_id]["started_at"]
        result_size = Path(output_path).stat().st_size if Path(output_path).exists() else 0
        final = {
            "status": "done",
            "progress": 100,
            "message": "Hoàn thành!",
            "elapsed": round(elapsed, 1),
            "result_size": result_size,
        }
        jobs[job_id].update(final)
        for q in list(ws_queues.get(job_id, [])):
            q.put_nowait(final)

    except JobCancelled:
        msg = {"status": "cancelled", "progress": 0, "message": "Đã hủy"}
        jobs[job_id].update(msg)
        for q in list(ws_queues.get(job_id, [])):
            q.put_nowait(msg)
        Path(output_path).unlink(missing_ok=True)

    except Exception as e:
        msg = {"status": "error", "progress": 0, "message": str(e)}
        jobs[job_id].update(msg)
        for q in list(ws_queues.get(job_id, [])):
            q.put_nowait(msg)

    finally:
        input_path.unlink(missing_ok=True)
        cancel_events.pop(job_id, None)


@app.get("/api/status/{job_id}")
async def get_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job không tìm thấy")
    job = jobs[job_id]
    return {
        "status": job["status"],
        "progress": job["progress"],
        "message": job["message"],
        "elapsed": job.get("elapsed"),
        "result_size": job.get("result_size"),
    }


@app.get("/api/result/{job_id}")
async def get_result(job_id: str):
    if job_id not in jobs:
        raise HTTPException(404, "Job không tìm thấy")
    if jobs[job_id]["status"] != "done":
        raise HTTPException(400, "Chưa hoàn thành")

    output_path = Path(jobs[job_id]["output_path"])
    if not output_path.exists():
        raise HTTPException(404, "File kết quả không tìm thấy")

    return FileResponse(
        output_path,
        media_type="image/jpeg",
        filename="upscaled.jpg",
    )


# Serve Vite build nếu đã build frontend
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="static")
