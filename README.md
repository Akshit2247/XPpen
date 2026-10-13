# XPpen: Digital Stylus Physics Simulator

A lightweight (< 300 lines total) simulation of XP-Pen hardware digitizers with 2nd-order spring-damper nib dynamics and 8,192 pressure levels.

## 🌐 Live Web Simulator
👉 **[https://akshit2247.github.io/XPpen/](https://akshit2247.github.io/XPpen/)**

## ⚡ Features
- **Spring-Mass-Damper Mechanics**: Eliminates robotic linework by simulating nib inertia, spring stiffness ($k$), and damping ($c$).
- **8,192 Pressure Levels**: Sigmoid curve mapping raw force into 8192 discrete pressure steps.
- **Autonomous Physics Orbit**: 3-pendulum harmonic simulation with exponential kinetic dampening.
- **Self-Contained**: Zero external CSS/JS dependencies. Runs anywhere.

## 🚀 Quickstart
```bash
# Run terminal Python simulation (generates xppen_art.svg)
python xppen.py

# Run local web server
python -m http.server 8000 --directory web
```
Open [http://localhost:8000](http://localhost:8000) to draw!
