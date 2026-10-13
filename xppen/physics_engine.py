"""
xppen.physics_engine
~~~~~~~~~~~~~~~~~~~~
Real-time Spring-Mass-Damper nib dynamics, 8,192-level pressure curve calibration,
and Stribeck paper-friction physics for digital stylus pens.

Author: @xppen-coder (written between 1:14 AM and 3:45 AM on too much cold brew)
"""

import math
import random
from dataclasses import dataclass, field
from typing import List, Tuple, Optional


@dataclass
class StylusState:
    """
    Current physical snapshot of the stylus pen tip.
    Bro, W3C pointer events actually give us tiltX and tiltY, but converting
    them to altitude and azimuth was an absolute nightmare of trigonometry.
    """
    x: float
    y: float
    pressure: float = 0.5       # normalized 0.0 to 1.0 (or raw 0..8191)
    tilt_x: float = 0.0         # degrees -90 to +90
    tilt_y: float = 0.0         # degrees -90 to +90
    twist: float = 0.0          # degrees 0 to 359
    timestamp: float = 0.0      # milliseconds
    velocity: float = 0.0       # pixels per ms


@dataclass
class SimulatedContact:
    """The actual ink contact footprint on the paper after physics do their thing."""
    x: float
    y: float
    radius_x: float
    radius_y: float
    angle_rad: float
    ink_flow: float             # how much ink is bleeding out right now
    effective_pressure: float   # after spring hysteresis and calibration curve
    friction_drag: float        # drag force felt by the artist


class StylusPhysicsSimulator:
    """
    Simulates the mechanical behavior of a modern digital pen (specifically
    calibrated for XP-Pen Deco / Artist pro series with 8,192 pressure levels).

    If you're wondering why standard lerp() wasn't good enough: regular linear
    interpolation makes strokes look like they were drawn by a robot with arthritis.
    We need second-order spring dynamics with damping so fast hand flings have inertia!
    """

    def __init__(
        self,
        mass: float = 1.2,              # virtual mass of the pen tip
        spring_k: float = 0.45,         # spring stiffness (higher = snappier)
        damping_c: float = 0.38,        # damping ratio (higher = less overshoot)
        pressure_curve: str = "s_curve",# 'linear', 'soft', 'firm', 's_curve'
        max_pressure_levels: int = 8192 # standard XP-Pen hardware resolution
    ):
        # Physics state vectors
        self.mass = max(0.1, mass)
        self.k = spring_k
        self.c = damping_c
        self.pressure_curve = pressure_curve
        self.max_levels = max_pressure_levels

        # Current tip position & velocity (spring-damper tracking)
        self.curr_x = 0.0
        self.curr_y = 0.0
        self.vx = 0.0
        self.vy = 0.0

        # Pressure hysteresis tracking (internal rubber gasket simulation)
        self.curr_pressure = 0.0
        self.prev_timestamp = None

        # Paper grain friction parameters (Stribeck curve)
        # Static friction > Coulomb friction > Viscous friction
        self.f_static = 0.15
        self.f_coulomb = 0.08
        self.v_stribeck = 1.2
        self.f_viscous = 0.003

        # Dev sanity counter
        self._total_ticks = 0

    def calibrate_pressure(self, raw_pressure: float) -> float:
        """
        Takes raw pressure [0.0, 1.0] and maps it through hardware pressure curves.
        XP-Pen drivers do this in C++, we're doing it in Python because we fear nothing.
        """
        # Clamp it first or weird NaN bugs happen when the stylus leaves the digitizer
        p = max(0.0, min(1.0, float(raw_pressure)))

        # Quantize to 8192 discrete hardware levels
        # (yeah I know floats are continuous, but authenticity matters bro)
        quantized_step = round(p * (self.max_levels - 1)) / (self.max_levels - 1)
        p = quantized_step

        if self.pressure_curve == "linear":
            return p
        elif self.pressure_curve == "soft":
            # Soft curve: effortless thick lines with light touch
            # Square root / gamma curve with gamma ~ 0.55
            return math.pow(p, 0.55)
        elif self.pressure_curve == "firm":
            # Firm curve: requires pushing harder, great for precision inking
            # Power curve gamma ~ 1.8
            return math.pow(p, 1.8)
        elif self.pressure_curve == "s_curve":
            # Classic Sigmoid S-curve: gentle start, expressive midtone, gradual saturation
            # Bro this sigmoid took 2 hours to tune so the zero-pressure floor stays at 0.0!
            k = 7.0
            x0 = 0.45
            raw_sig = 1.0 / (1.0 + math.exp(-k * (p - x0)))
            floor_sig = 1.0 / (1.0 + math.exp(-k * (0.0 - x0)))
            ceil_sig = 1.0 / (1.0 + math.exp(-k * (1.0 - x0)))
            normalized = (raw_sig - floor_sig) / (ceil_sig - floor_sig)
            return max(0.0, min(1.0, normalized))
        else:
            # Fallback if someone passed a weird typo string
            # print("yo invalid curve name, falling back to linear smh")
            return p

    def update(self, target: StylusState) -> SimulatedContact:
        """
        Advances the physical simulation by one tick using semi-implicit Euler integration.
        Semi-implicit Euler is vastly more stable than standard Euler and doesn't blow up
        when the user furiously scribbles across the canvas at 1000px/s.
        """
        self._total_ticks += 1

        # First tick initialization
        if self.prev_timestamp is None:
            self.curr_x = target.x
            self.curr_y = target.y
            self.curr_pressure = self.calibrate_pressure(target.pressure)
            self.prev_timestamp = target.timestamp or 0.0
            dt = 16.67  # assume 60fps for first frame
        else:
            dt = (target.timestamp - self.prev_timestamp) if target.timestamp else 16.67
            # Guard against weird zero or negative dt from weird browser events
            if dt <= 0.1:
                dt = 1.0
            elif dt > 100.0:
                # User paused or switched tabs, don't slingshot across the universe
                dt = 16.67
            self.prev_timestamp = target.timestamp

        # Convert dt to seconds for cleaner SI units (scaled for screen pixels)
        dt_s = dt / 1000.0

        # --- 1. Position Spring-Damper System ---
        # Hooke's Law: F_spring = -k * (x - target_x)
        # Damping: F_damper = -c * v
        dx = target.x - self.curr_x
        dy = target.y - self.curr_y

        f_spring_x = self.k * dx * 60.0
        f_spring_y = self.k * dy * 60.0
        f_damp_x = -self.c * self.vx * 30.0
        f_damp_y = -self.c * self.vy * 30.0

        # Calculate speed for Stribeck paper-friction resistance
        speed = math.hypot(self.vx, self.vy)
        drag_force = 0.0
        if speed > 1e-4:
            # Stribeck friction model: F = (Fc + (Fs - Fc)*exp(-(v/vs)^2) + Fv*v)
            f_stribeck = (
                self.f_coulomb
                + (self.f_static - self.f_coulomb) * math.exp(-((speed / self.v_stribeck) ** 2))
                + self.f_viscous * speed
            )
            # Pressure scales friction (pushing harder = more paper drag)
            scaled_friction = f_stribeck * (1.0 + self.curr_pressure * 2.0)
            drag_x = -(self.vx / speed) * scaled_friction
            drag_y = -(self.vy / speed) * scaled_friction
            drag_force = scaled_friction
        else:
            drag_x = 0.0
            drag_y = 0.0

        # Net acceleration: a = F / m
        ax = (f_spring_x + f_damp_x + drag_x) / self.mass
        ay = (f_spring_y + f_damp_y + drag_y) / self.mass

        # Semi-implicit Euler integration
        self.vx += ax * dt_s * 60.0
        self.vy += ay * dt_s * 60.0
        self.curr_x += self.vx * dt_s * 60.0
        self.curr_y += self.vy * dt_s * 60.0

        # --- 2. Pressure Hysteresis & Filtering ---
        # Stylus mechanical springs don't react instantaneously.
        # Attack rate (pushing down) is faster than release rate (letting go).
        target_calibrated_p = self.calibrate_pressure(target.pressure)
        if target_calibrated_p > self.curr_pressure:
            alpha = 0.35  # attack smoothing
        else:
            alpha = 0.20  # release lag (feels juicy and physical)
        self.curr_pressure += alpha * (target_calibrated_p - self.curr_pressure)

        # --- 3. Tilt & Nib Elliptical Footprint Calculation ---
        # Real XP-Pen styluses support +/- 60 deg tilt in X and Y.
        # When tilted, the pen tip contacts the paper as an ellipse, not a circle!
        rad_tx = math.radians(target.tilt_x)
        rad_ty = math.radians(target.tilt_y)

        # Vector in 3D: pen orientation
        # Bro, spherical coordinates in screen space is why I have trust issues:
        tilt_magnitude = math.sqrt(rad_tx * rad_tx + rad_ty * rad_ty)
        tilt_angle = math.atan2(rad_ty, rad_tx) if tilt_magnitude > 1e-4 else 0.0

        # Base radius determined by calibrated pressure
        # Min radius 1.5px, max radius 28.0px
        base_radius = 1.5 + (self.curr_pressure ** 1.2) * 26.5

        # As tilt increases, the contact footprint stretches along the tilt axis
        stretch_factor = 1.0 + math.sin(tilt_magnitude) * 1.8
        radius_major = base_radius * stretch_factor
        radius_minor = base_radius / max(1.0, math.sqrt(stretch_factor))

        # Ink flow volume: proportional to pressure, slightly boosted by slower speeds
        # (holding the pen still bleeds more ink into the paper fiber)
        bleed_boost = 1.0 / (1.0 + speed * 0.05)
        ink_flow = (self.curr_pressure * 0.85 + 0.15 * bleed_boost)

        return SimulatedContact(
            x=self.curr_x,
            y=self.curr_y,
            radius_x=radius_major,
            radius_y=radius_minor,
            angle_rad=tilt_angle,
            ink_flow=ink_flow,
            effective_pressure=self.curr_pressure,
            friction_drag=drag_force
        )

    def reset(self, x: float = 0.0, y: float = 0.0):
        """Reset simulator when pen lifts up from digitizer surface."""
        self.curr_x = x
        self.curr_y = y
        self.vx = 0.0
        self.vy = 0.0
        self.curr_pressure = 0.0
        self.prev_timestamp = None
