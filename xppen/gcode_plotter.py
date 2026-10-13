"""
xppen.gcode_plotter
~~~~~~~~~~~~~~~~~~~
CNC pen plotter / AxiDraw G-code generator featuring:
- Traveling Salesman Problem (TSP) 2-Opt path optimization to eradicate pen-up air-travel lag
- Bi-directional stroke reversal matching
- Pressure-to-Z-depth servo deflection mapping
- Algorithmic cross-hatch shading engine

Author: @xppen-coder (written because watching my physical pen plotter waste 20 minutes flying through the air gave me physical pain)
"""

import math
from dataclasses import dataclass
from typing import List, Tuple, Optional


@dataclass
class PlotterStroke:
    points: List[Tuple[float, float, float]]  # (x, y, pressure)
    reversible: bool = True

    @property
    def start_pt(self) -> Tuple[float, float]:
        return (self.points[0][0], self.points[0][1])

    @property
    def end_pt(self) -> Tuple[float, float]:
        return (self.points[-1][0], self.points[-1][1])

    def reversed(self) -> "PlotterStroke":
        return PlotterStroke(
            points=list(reversed(self.points)),
            reversible=self.reversible
        )


class PlotterOptimizer:
    """
    Solves the Pen Plotter Traveling Salesman problem.
    Re-orders and reverses strokes so the physical pen tip spends
    maximum time drawing ink and minimum time hovering uselessly in the air.
    """

    @staticmethod
    def dist(p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

    def optimize_strokes(self, strokes: List[PlotterStroke], run_2opt: bool = True) -> List[PlotterStroke]:
        """
        Stage 1: Greedy Nearest-Neighbor with bidirectional flip.
        Stage 2: 2-Opt iterative descent local search.
        """
        if len(strokes) <= 1:
            return strokes

        # --- Stage 1: Greedy Nearest-Neighbor ---
        unvisited = list(strokes)
        current = unvisited.pop(0)
        ordered: List[PlotterStroke] = [current]

        while unvisited:
            curr_end = current.end_pt
            best_idx = 0
            best_dist = float('inf')
            best_flipped = False

            for i, cand in enumerate(unvisited):
                # Option A: draw candidate forwards
                d_forward = self.dist(curr_end, cand.start_pt)
                if d_forward < best_dist:
                    best_dist = d_forward
                    best_idx = i
                    best_flipped = False

                # Option B: draw candidate backwards (if reversible)
                if cand.reversible:
                    d_reverse = self.dist(curr_end, cand.end_pt)
                    if d_reverse < best_dist:
                        best_dist = d_reverse
                        best_idx = i
                        best_flipped = True

            chosen = unvisited.pop(best_idx)
            if best_flipped:
                chosen = chosen.reversed()
            ordered.append(chosen)
            current = chosen

        if not run_2opt or len(ordered) < 4:
            return ordered

        # --- Stage 2: 2-Opt TSP Iterative Improvement ---
        # Look for crossing air-travel paths and untangle them
        # Warning: O(N^2) per iteration, cap at 50 iterations or until converged
        improved = True
        iterations = 0
        max_iterations = 40

        while improved and iterations < max_iterations:
            improved = False
            iterations += 1
            n = len(ordered)

            for i in range(n - 2):
                for j in range(i + 2, n):
                    # Air travel distance between i and i+1, and j and j+1 (if exists)
                    p_i_end = ordered[i].end_pt
                    p_i1_start = ordered[i + 1].start_pt

                    d_cur = self.dist(p_i_end, p_i1_start)

                    # If we reverse the segment from i+1 to j:
                    # new connection is from ordered[i].end_pt to ordered[j].end_pt
                    # (with ordered[j] reversed)
                    p_j_end = ordered[j].end_pt
                    d_new = self.dist(p_i_end, p_j_end)

                    # Only swap if saving is tangible (> 2 pixels)
                    if d_new + 2.0 < d_cur:
                        # Reverse subarray and flip stroke directions
                        reversed_sub = [s.reversed() if s.reversible else s for s in reversed(ordered[i + 1 : j + 1])]
                        ordered[i + 1 : j + 1] = reversed_sub
                        improved = True
                        break
                if improved:
                    break

        return ordered


class GCodeGenerator:
    """
    Turns vector strokes into production-ready G-code for AxiDraw, GRBL,
    Marlin, or homebrew Arduino servo plotters.
    """

    def __init__(
        self,
        z_up: float = 5.0,           # safe travel height (mm)
        z_down_base: float = 0.0,    # standard pen contact height (mm)
        z_down_max_depth: float = 1.5,# depth flex for pressure (mm)
        feedrate_draw: int = 1800,   # mm/min drawing speed
        feedrate_travel: int = 4500, # mm/min rapid transit
        scale_px_to_mm: float = 0.264583 # 96 DPI screen pixel to mm standard
    ):
        self.z_up = z_up
        self.z_down_base = z_down_base
        self.z_depth = z_down_max_depth
        self.feed_draw = feedrate_draw
        self.feed_travel = feedrate_travel
        self.px2mm = scale_px_to_mm

    def generate(self, strokes: List[PlotterStroke], optimize_first: bool = True) -> str:
        """Generates the full G-code text file."""
        if optimize_first:
            optimizer = PlotterOptimizer()
            strokes = optimizer.optimize_strokes(strokes)

        lines = [
            "; --- Generated by XPpen Studio G-Code Engine ---",
            "; Mode: High-Precision Dynamic Pressure Plotter",
            "; Bro, make sure your pen holder thumbscrew is tight!",
            "G21 ; Set units to millimeters",
            "G90 ; Absolute coordinates",
            f"G00 Z{self.z_up:.2f} F{self.feed_travel} ; Pen UP to safety clearance",
            "G04 P200 ; Dwell 200ms to let servo stabilize",
            ""
        ]

        total_dist_drawn = 0.0
        total_dist_travel = 0.0
        curr_x, curr_y = 0.0, 0.0

        for s_idx, stroke in enumerate(strokes):
            if not stroke.points:
                continue

            start_x = stroke.points[0][0] * self.px2mm
            start_y = stroke.points[0][1] * self.px2mm

            # 1. Travel in the air to start point
            air_dist = math.hypot(start_x - curr_x, start_y - curr_y)
            total_dist_travel += air_dist

            lines.append(f"; Stroke #{s_idx + 1} ({len(stroke.points)} vertices)")
            lines.append(f"G00 X{start_x:.3f} Y{start_y:.3f} F{self.feed_travel}")

            # 2. Lower pen tip to paper
            init_p = stroke.points[0][2]
            init_z = self.z_down_base - (init_p * self.z_depth)
            lines.append(f"G01 Z{init_z:.3f} F{self.feed_draw}")

            # 3. Draw each segment
            last_x, last_y = start_x, start_y
            for pt in stroke.points[1:]:
                px = pt[0] * self.px2mm
                py = pt[1] * self.px2mm
                p = pt[2]
                z = self.z_down_base - (p * self.z_depth)

                seg_dist = math.hypot(px - last_x, py - last_y)
                total_dist_drawn += seg_dist

                lines.append(f"G01 X{px:.3f} Y{py:.3f} Z{z:.3f} F{self.feed_draw}")
                last_x, last_y = px, py

            # 4. Lift pen UP
            lines.append(f"G00 Z{self.z_up:.2f} F{self.feed_travel}")
            curr_x, curr_y = last_x, last_y
            lines.append("")

        # Park pen back at home
        lines.append("; --- End of Plot ---")
        lines.append(f"G00 X0.000 Y0.000 Z{self.z_up:.2f} F{self.feed_travel}")
        lines.append("M02 ; Program end")
        lines.append(f"; Stats: Drawn = {total_dist_drawn:.1f} mm, Air-Travel = {total_dist_travel:.1f} mm")

        return "\n".join(lines)


class CrossHatchGenerator:
    """
    Creates dynamic cross-hatch shading lines with angle variance
    and pressure gradient modulation for physical pen plotters.
    """

    def __init__(self, angle1_deg: float = 45.0, angle2_deg: float = 135.0, spacing: float = 8.0):
        self.angle1 = math.radians(angle1_deg)
        self.angle2 = math.radians(angle2_deg)
        self.spacing = spacing

    def hatch_rect(self, x: float, y: float, w: float, h: float, density: float = 1.0) -> List[PlotterStroke]:
        """Generates cross-hatching inside an [x, y, w, h] rectangle."""
        strokes = []
        eff_spacing = max(2.0, self.spacing / max(0.2, density))

        # First pass: angle 1
        strokes.extend(self._hatch_angle(x, y, w, h, self.angle1, eff_spacing))

        # Second pass: angle 2 (cross-hatching) if density > 1.2
        if density > 1.2:
            strokes.extend(self._hatch_angle(x, y, w, h, self.angle2, eff_spacing * 1.3))

        return strokes

    def _hatch_angle(self, x: float, y: float, w: float, h: float, angle_rad: float, spacing: float) -> List[PlotterStroke]:
        strokes = []
        diag = math.hypot(w, h)
        cx, cy = x + w * 0.5, y + h * 0.5

        num_lines = int(diag / spacing)
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        perp_cos = -sin_a
        perp_sin = cos_a

        for i in range(-num_lines // 2, num_lines // 2):
            offset = i * spacing
            mid_x = cx + perp_cos * offset
            mid_y = cy + perp_sin * offset

            p1_x = mid_x - cos_a * (diag * 0.5)
            p1_y = mid_y - sin_a * (diag * 0.5)
            p2_x = mid_x + cos_a * (diag * 0.5)
            p2_y = mid_y + sin_a * (diag * 0.5)

            # Pressure ramps up in the center for organic shading
            p_mid = 0.85
            p_edge = 0.35

            strokes.append(PlotterStroke(
                points=[
                    (p1_x, p1_y, p_edge),
                    (mid_x, mid_y, p_mid),
                    (p2_x, p2_y, p_edge)
                ]
            ))

        return strokes
