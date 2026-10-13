# 📓 Dev's Unhinged 3:00 AM Engineering Log
> *"Why did I decide to simulate vintage fountain pen capillary railroading in Python on a Tuesday night? Nobody knows."*

---

### Entry 1 — 01:14 AM: The Stiff Tablet Problem
Standard digital inking apps just do `x = lerp(x, target_x, 0.5)`. Bro, that's why drawing on cheap tablets feels like dragging a dead mouse across a cutting board. 
If you flick your wrist quickly with an XP-Pen stylus, the physical nib tip has **inertia**, the internal coil has **spring stiffness ($k$)**, and the rubber seal has **damping ($c$)**. 

I ended up writing a second-order spring-mass-damper system. First run with standard Euler exploded into outer space because `dt` had a spike when Chrome stuttered (`x = NaN`). Replaced it with semi-implicit Euler integration and now it tracks like butter.

### Entry 2 — 02:08 AM: Philip J. Schneider is a Legend
Spent 2 hours with *Graphics Gems I* (1990) re-implementing Schneider's recursive Bézier curve fitting algorithm. 
- Attempt 1: Inverted the determinant of the 2x2 matrix, control points flew backwards into negative coordinates lmao.
- Attempt 2: Forgot that tablet digitizers fire duplicate points when the stylus hovers. Added chord length protection.
- Result: 82.8% reduction in path vertex count! 3,000 jittery digitizer raw points compressed down to ~120 silky C1-continuous cubic Bézier curves. My CPU is literally smiling.

### Entry 3 — 02:49 AM: AxiDraw Plotters and the Traveling Salesman
Watching my physical pen plotter draw is normally satisfying until you realize it spends 60% of its time flying through the air between disconnected strokes like a lost pigeon.
Implemented greedy nearest-neighbor clustering + 2-Opt local search edge swapping. Also made strokes bi-directionally flippable (if a stroke can be drawn backwards without affecting visual quality, why travel to the other end?). Air travel reduced by ~48%. The stepper motors will thank me.

### Entry 4 — 03:22 AM: Vintage Flex Nib & Surface Tension
Every calligraphy nerd knows what "railroading" is: when you push too hard on a vintage Brause 66EF or Waterman 52 Pink nib, the two steel tines spread apart so far that the ink surface tension snaps, leaving two ugly parallel tramlines.
Added an Euler-Bernoulli cantilever beam model and a critical tine width threshold. If you push past 18px width while moving fast, it railroads! It's an imperfection, but it feels so human.

### Entry 5 — 03:55 AM: Caffeine Hand Tremor Simulator
Why does AI generated art always look uncanny? Because the lines are too mathematically perfect. Biological humans have:
1. 8–12 Hz physiological hand micro-tremors from muscle motor units.
2. ~1.2 Hz pulse beats (the blood pressure in your fingertips tightens your pen grip on each heartbeat).
3. 2:00 AM cold brew jitters.

Added the `caffeine` parameter. Set it to 0.0 for zen monk strokes, or 0.8 for "I drank 3 energy drinks and my hands are vibrating into the 4th dimension".

---
*Status: It works, it's fast, and it runs in both Python CLI and directly in the browser via Pyodide WebAssembly. Time to commit and push.*
