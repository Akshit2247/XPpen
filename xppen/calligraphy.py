"""
xppen.calligraphy
~~~~~~~~~~~~~~~~~
Pointed-nib cantilever beam deflection (flex nib tine spreading),
surface-tension capillary collapse ('railroading'), Gothic broad-edge
ribbon trigonometry, and fountain pen reservoir depletion.

Author: @xppen-coder (I spent 4 hours studying fountain pen nib metallurgy at 3am)
"""

import math
from dataclasses import dataclass, field
from typing import List, Tuple, Optional


@dataclass
class CalligraphyVertex:
    x: float
    y: float
    left_x: float
    left_y: float
    right_x: float
    right_y: float
    is_railroading: bool = False
    railroad_gap: float = 0.0
    opacity: float = 1.0


class BroadEdgeNib:
    """
    Simulates a chiseled broad calligraphy nib (Gothic Textura / Italian Chancery).
    The nib is held at a fixed angle (usually 40° to 45° to the baseline).
    Lines parallel to the nib angle are razor-thin hairlines;
    lines perpendicular are chunky, powerful downstrokes.
    """

    def __init__(self, width: float = 18.0, angle_deg: float = 45.0):
        self.width = width
        self.angle_rad = math.radians(angle_deg)
        # Vector offsets from center to left and right tips of the chisel
        self.half_w = width * 0.5
        self.dx = self.half_w * math.cos(self.angle_rad)
        self.dy = self.half_w * math.sin(self.angle_rad)

    def compute_polygon_strip(self, points: List[Tuple[float, float, float]]) -> List[CalligraphyVertex]:
        """
        Takes raw [(x, y, pressure), ...] and builds the sweeping ribbon vertices.
        """
        vertices = []
        for x, y, p in points:
            # Broad nib pressure slightly expands the cut by flexing the brass
            p_scale = 0.85 + 0.3 * p
            cur_dx = self.dx * p_scale
            cur_dy = self.dy * p_scale

            vertices.append(CalligraphyVertex(
                x=x,
                y=y,
                left_x=x - cur_dx,
                left_y=y - cur_dy,
                right_x=x + cur_dx,
                right_y=y + cur_dy
            ))
        return vertices


class PointedFlexNib:
    """
    Simulates a high-end vintage flex nib (like a Waterman 52 Pink or Brause 66EF).
    As pressure increases, the two steel tines physically spread apart according
    to Euler-Bernoulli beam deflection theory.

    If you pull the pen too fast while pressing too hard, surface tension collapses
    and you get 'RAILROADING' (two thin parallel tracks with empty white space in between).
    Every calligraphy nerd knows this pain, so of course we had to simulate it.
    """

    def __init__(
        self,
        base_hairline: float = 1.2,      # width at zero pressure
        max_swell: float = 32.0,         # maximum tine spread
        spring_modulus: float = 1.8,     # stiffness
        surface_tension_limit: float = 24.0, # width where ink bridge snaps
        reservoir_capacity: float = 1000.0   # arbitrary ink units
    ):
        self.base_hairline = base_hairline
        self.max_swell = max_swell
        self.spring_modulus = spring_modulus
        self.surface_tension_limit = surface_tension_limit
        self.reservoir = reservoir_capacity
        self.max_reservoir = reservoir_capacity

    def process_stroke(
        self,
        stroke_samples: List[Tuple[float, float, float, float]] # (x, y, pressure, velocity)
    ) -> List[CalligraphyVertex]:
        vertices = []

        for i, (x, y, pressure, vel) in enumerate(stroke_samples):
            # 1. Cantilever tine deflection
            # Beam deflection under point load: delta ~ F / k
            tine_spread = (pressure ** self.spring_modulus) * self.max_swell
            effective_width = self.base_hairline + tine_spread

            # 2. Surface tension & railroading check
            # Faster movement drains capillary replenishment, making railroad more likely
            dynamic_limit = self.surface_tension_limit * max(0.2, (1.0 - vel * 0.04))
            is_railroading = False
            railroad_gap = 0.0

            if effective_width > dynamic_limit and self.reservoir > 0.0:
                is_railroading = True
                railroad_gap = effective_width * 0.65  # empty space between tines

            # 3. Ink reservoir depletion
            # Thicker lines dump more ink into the fibers
            ink_consumed = (effective_width * 0.08) + 0.02
            self.reservoir = max(0.0, self.reservoir - ink_consumed)

            # Fade opacity if pen is running completely dry
            opacity = min(1.0, (self.reservoir / (self.max_reservoir * 0.15)))

            # Calculate normal vector perpendicular to stroke direction
            if i < len(stroke_samples) - 1:
                nx = stroke_samples[i + 1][0] - x
                ny = stroke_samples[i + 1][1] - y
            elif i > 0:
                nx = x - stroke_samples[i - 1][0]
                ny = y - stroke_samples[i - 1][1]
            else:
                nx, ny = 1.0, 0.0

            dist = math.hypot(nx, ny)
            if dist < 1e-5:
                perp_x, perp_y = 0.0, 1.0
            else:
                # 90-degree normal vector
                perp_x = -ny / dist
                perp_y = nx / dist

            half_w = effective_width * 0.5
            vertices.append(CalligraphyVertex(
                x=x,
                y=y,
                left_x=x - perp_x * half_w,
                left_y=y - perp_y * half_w,
                right_x=x + perp_x * half_w,
                right_y=y + perp_y * half_w,
                is_railroading=is_railroading,
                railroad_gap=railroad_gap,
                opacity=opacity
            ))

        return vertices

    def dip_in_inkwell(self):
        """Bro reload the ink, you've been scribbling too much."""
        self.reservoir = self.max_reservoir
