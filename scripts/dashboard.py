#!/usr/bin/env python3
"""Terminal performance dashboard: CPU, memory, GPU. Stdlib only.

Run locally or over SSH:
    ssh -t user@server python3 /path/to/scripts/dashboard.py
    python3 scripts/dashboard.py --interval 2
    python3 scripts/dashboard.py --once      # single snapshot, no TTY needed
Press q or Ctrl+C to quit.
"""
import argparse, os, select, shutil, subprocess, sys, time

def read_cpu():
    with open("/proc/stat") as f:
        out = []
        for line in f:
            if not line.startswith("cpu"):
                break
            p = line.split()
            v = list(map(int, p[1:9]))
            out.append((p[0], sum(v), v[3] + v[4]))  # total, idle+iowait
    return out

def cpu_usage(prev, cur):
    res = {}
    for (n, t0, i0), (_, t1, i1) in zip(prev, cur):
        dt = t1 - t0
        res[n] = 0.0 if dt <= 0 else 100.0 * (1 - (i1 - i0) / dt)
    return res

def read_mem():
    m = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, v = line.split(":")
            m[k] = int(v.split()[0]) * 1024
    used = m["MemTotal"] - m.get("MemAvailable", m["MemFree"])
    swap_used = m.get("SwapTotal", 0) - m.get("SwapFree", 0)
    return m["MemTotal"], used, m.get("SwapTotal", 0), swap_used

def read_gpus():
    q = "index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw"
    try:
        out = subprocess.run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=5)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return None
    if out.returncode != 0:
        return None
    gpus = []
    for line in out.stdout.strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        def f(x):
            try: return float(x)
            except ValueError: return None
        gpus.append(dict(idx=p[0], name=p[1], util=f(p[2]), mu=f(p[3]), mt=f(p[4]), temp=f(p[5]), pw=f(p[6])))
    return gpus

def gb(b): return f"{b / 2**30:.1f}G"

def bar(pct, width):
    pct = max(0.0, min(100.0, pct or 0.0))
    n = round(width * pct / 100)
    col = "32" if pct < 60 else "33" if pct < 85 else "31"
    return f"\033[{col}m{'█' * n}\033[90m{'░' * (width - n)}\033[0m"

def render(prev, cur, cols, color_ok=True):
    w = max(10, min(cols - 30, 50))
    usage = cpu_usage(prev, cur)
    L = []
    host = os.uname().nodename
    load = os.getloadavg()
    L.append(f"\033[1m{host}\033[0m  {time.strftime('%Y-%m-%d %H:%M:%S')}  load {load[0]:.2f} {load[1]:.2f} {load[2]:.2f}")
    L.append("")
    L.append("\033[1mCPU\033[0m")
    L.append(f"  total   {bar(usage['cpu'], w)} {usage['cpu']:5.1f}%")
    cores = [k for k in usage if k != "cpu"]
    if len(cores) <= 16:
        for k in cores:
            L.append(f"  {k:<7} {bar(usage[k], w)} {usage[k]:5.1f}%")
    L.append("")
    tot, used, st, su = read_mem()
    L.append("\033[1mMemory\033[0m")
    L.append(f"  RAM     {bar(100 * used / tot, w)} {gb(used)}/{gb(tot)}")
    if st:
        L.append(f"  swap    {bar(100 * su / st, w)} {gb(su)}/{gb(st)}")
    L.append("")
    L.append("\033[1mGPU\033[0m")
    gpus = read_gpus()
    if gpus is None:
        L.append("  nvidia-smi not available")
    for g in gpus or []:
        L.append(f"  [{g['idx']}] {g['name']}  " + " ".join(
            s for s in (f"{g['temp']:.0f}°C" if g['temp'] is not None else "",
                        f"{g['pw']:.0f}W" if g['pw'] is not None else "") if s))
        L.append(f"   util   {bar(g['util'], w)} {g['util'] or 0:5.1f}%")
        if g['mt']:
            L.append(f"   vram   {bar(100 * g['mu'] / g['mt'], w)} {g['mu']/1024:.1f}/{g['mt']/1024:.1f}G")
    return L

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-i", "--interval", type=float, default=1.0)
    ap.add_argument("--once", action="store_true")
    a = ap.parse_args()
    prev = read_cpu()
    time.sleep(0.5 if a.once else a.interval)
    cur = read_cpu()
    if a.once:
        print("\n".join(render(prev, cur, shutil.get_terminal_size((100, 24)).columns)))
        return
    interactive = sys.stdin.isatty()
    if interactive:
        import termios, tty
        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        tty.setcbreak(fd)
    sys.stdout.write("\033[?1049h\033[?25l")
    try:
        while True:
            cols = shutil.get_terminal_size((100, 24)).columns
            lines = render(prev, cur, cols)
            sys.stdout.write("\033[H" + "\033[K\n".join(lines) + "\033[K\n\033[J")
            sys.stdout.write("\033[90mq to quit\033[0m")
            sys.stdout.flush()
            prev = cur
            if interactive:
                r, _, _ = select.select([sys.stdin], [], [], a.interval)
                if r and sys.stdin.read(1).lower() == "q":
                    break
            else:
                time.sleep(a.interval)
            cur = read_cpu()
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?25h\033[?1049l")
        if interactive:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

if __name__ == "__main__":
    main()
