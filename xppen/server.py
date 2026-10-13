"""
xppen.server
~~~~~~~~~~~~
Full-stack FastAPI server for XPpen Studio.
Serves the web app and provides REST + WebSocket endpoints for real-time
pen coordinate streaming, Bezier fitting, and G-code generation.

Run with:
    python -m xppen.server
or
    uvicorn xppen.server:app --reload --port 8000
"""

import os
import sys
from typing import List, Dict, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from .physics_engine import StylusPhysicsSimulator, StylusState
from .bezier_synth import BezierFitter, Point2D
from .calligraphy import PointedFlexNib, BroadEdgeNib
from .gcode_plotter import GCodeGenerator, PlotterStroke
from .generative_pens import SpirographPen, LorenzAttractorPen, HarmonographPen
from .human_jitter import HumanHandImperfectionSimulator

app = FastAPI(title="XPpen Studio API", version="1.0.0-unhinged")

# Base directory for web static assets
WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


class StrokePointModel(BaseModel):
    x: float
    y: float
    pressure: float = 0.5
    tilt_x: float = 0.0
    tilt_y: float = 0.0
    timestamp: float = 0.0


class ProcessStrokeRequest(BaseModel):
    points: List[StrokePointModel]
    error_tolerance: float = 3.0
    pressure_curve: str = "s_curve"
    caffeine: float = 0.0


@app.get("/api/health")
async def health_check():
    return {
        "status": "vibing",
        "engine": "XPpen Python 3.12",
        "message": "Stylus physics engine ready for action bro"
    }


@app.post("/api/bezier/fit")
async def fit_bezier_stroke(req: ProcessStrokeRequest):
    """Takes raw sampled points and runs Schneider's recursive Bezier fitting."""
    if not req.points:
        return {"segments": [], "count": 0}

    # Optional caffeine jitter
    pts_tuples = [(p.x, p.y, p.pressure) for p in req.points]
    if req.caffeine > 0.0:
        humanizer = HumanHandImperfectionSimulator(caffeine_level=req.caffeine)
        pts_tuples = humanizer.humanize_stroke(pts_tuples)

    pts2d = [Point2D(p[0], p[1], p[2]) for p in pts_tuples]
    fitter = BezierFitter(error_tolerance=req.error_tolerance)
    segments = fitter.fit_curve(pts2d)

    out_segs = []
    for s in segments:
        out_segs.append({
            "p0": {"x": s.p0.x, "y": s.p0.y},
            "p1": {"x": s.p1.x, "y": s.p1.y},
            "p2": {"x": s.p2.x, "y": s.p2.y},
            "p3": {"x": s.p3.x, "y": s.p3.y},
            "start_pressure": s.start_pressure,
            "end_pressure": s.end_pressure,
            "svg_cmd": s.to_svg_path_cmd(),
            "arc_length": s.arc_length()
        })

    return {
        "segments": out_segs,
        "input_points_count": len(req.points),
        "output_segments_count": len(out_segs),
        "compression_pct": round(100.0 - (len(out_segs) * 4 / max(1, len(req.points)) * 100.0), 1)
    }


@app.post("/api/gcode/generate")
async def generate_gcode_endpoint(strokes_data: List[List[List[float]]]):
    """Generates 2-Opt optimized G-code from multi-stroke drawing."""
    plotter_strokes = []
    for raw_s in strokes_data:
        pts = [(pt[0], pt[1], pt[2] if len(pt) > 2 else 0.5) for pt in raw_s]
        plotter_strokes.append(PlotterStroke(points=pts))

    gen = GCodeGenerator()
    gcode = gen.generate(plotter_strokes, optimize_first=True)
    return {"gcode": gcode}


# Mount web directory if it exists
if os.path.exists(WEB_DIR):
    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


def run_server():
    import uvicorn
    print("🚀 Starting XPpen Studio Local Server at http://localhost:8000 ...")
    uvicorn.run("xppen.server:app", host="127.0.0.1", port=8000, reload=False)


if __name__ == "__main__":
    run_server()
