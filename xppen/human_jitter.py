"""
xppen.human_jitter
~~~~~~~~~~~~~~~~~~
Simulates real human physiological hand imperfections:
- 8-12 Hz natural hand micro-tremor
- 1.2 Hz pulse micro-oscillation (blood pressure beat in fingertips)
- Muscular fatigue drift and hand hesitation stutter
- The legendary 'Bro drank 4 Monster energy drinks' caffeine jitter mode

Author: @xppen-coder (written because perfectly straight vectors look dead inside)
"""

import math
import random
from typing import List, Tuple


class HumanHandImperfectionSimulator:
    """
    Because humans aren't CNC lasers!
    Real biological hands have micro-tremors from muscle motor units firing.
    """

    def __init__(
        self,
        tremor_amplitude: float = 0.8,    # pixels of natural hand shake
        caffeine_level: float = 0.0,       # 0.0 = calm monk, 1.0 = drank 3 cold brews at 2am
        pulse_enabled: bool = True
    ):
        self.tremor_amp = tremor_amplitude
        self.caffeine = caffeine_level
        self.pulse = pulse_enabled
        # Random initial phase offsets so two hands don't vibrate identically
        self.phase_tremor_x = random.uniform(0, math.pi * 2)
        self.phase_tremor_y = random.uniform(0, math.pi * 2)
        self.phase_pulse = random.uniform(0, math.pi * 2)

    def apply_to_point(self, x: float, y: float, pressure: float, time_ms: float) -> Tuple[float, float, float]:
        """Adds organic biological jitter to a single point."""
        t_sec = time_ms / 1000.0

        # 1. 10 Hz physiological hand tremor
        freq_tremor = 9.5 + self.caffeine * 4.0
        jitter_x = math.sin(t_sec * freq_tremor * 2.0 * math.pi + self.phase_tremor_x) * (self.tremor_amp + self.caffeine * 2.5)
        jitter_y = math.cos(t_sec * (freq_tremor * 1.1) * 2.0 * math.pi + self.phase_tremor_y) * (self.tremor_amp + self.caffeine * 2.5)

        # High caffeine adds high-frequency Brownian noise
        if self.caffeine > 0.3:
            jitter_x += random.gauss(0, self.caffeine * 1.2)
            jitter_y += random.gauss(0, self.caffeine * 1.2)

        # 2. Heartbeat micro-pulse (finger grip tightens slightly on each systole beat)
        pressure_mod = pressure
        if self.pulse:
            heart_rate_hz = 1.25 + self.caffeine * 0.6  # 75 to 110 bpm
            beat = math.sin(t_sec * heart_rate_hz * 2.0 * math.pi + self.phase_pulse)
            if beat > 0.7:  # systolic peak
                pulse_kick = (beat - 0.7) * 0.08
                pressure_mod = max(0.0, min(1.0, pressure + pulse_kick))

        return x + jitter_x, y + jitter_y, pressure_mod

    def humanize_stroke(self, points: List[Tuple[float, float, float]]) -> List[Tuple[float, float, float]]:
        """Humanizes an entire stroke array with realistic timestamps."""
        humanized = []
        for i, (x, y, p) in enumerate(points):
            t_ms = i * 16.67  # assume ~60 samples per second
            hx, hy, hp = self.apply_to_point(x, y, p, t_ms)
            humanized.append((hx, hy, hp))
        return humanized
