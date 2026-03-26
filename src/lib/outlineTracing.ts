export type OutlinePoint = { x: number; y: number };

export type DashScale = { dash: number; gap: number };

export const defaultDashScale: DashScale = { dash: 2, gap: 1.5 };

export const buildMarchingSquaresSegments = (
  mask: Uint8Array,
  width: number,
  height: number
) => {
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const idx = (x: number, y: number) => y * width + x;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const tl = mask[idx(x, y)] ? 1 : 0;
      const tr = mask[idx(x + 1, y)] ? 2 : 0;
      const br = mask[idx(x + 1, y + 1)] ? 4 : 0;
      const bl = mask[idx(x, y + 1)] ? 8 : 0;
      const code = tl | tr | br | bl;
      if (code === 0 || code === 15) continue;
      const top = { x: x + 0.5, y };
      const right = { x: x + 1, y: y + 0.5 };
      const bottom = { x: x + 0.5, y: y + 1 };
      const left = { x, y: y + 0.5 };
      switch (code) {
        case 1:
          segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
          break;
        case 2:
          segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
          break;
        case 3:
          segments.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
          break;
        case 4:
          segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
          break;
        case 5:
          segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
          segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
          break;
        case 6:
          segments.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
          break;
        case 7:
          segments.push({ x1: left.x, y1: left.y, x2: bottom.x, y2: bottom.y });
          break;
        case 8:
          segments.push({ x1: bottom.x, y1: bottom.y, x2: left.x, y2: left.y });
          break;
        case 9:
          segments.push({ x1: top.x, y1: top.y, x2: bottom.x, y2: bottom.y });
          break;
        case 10:
          segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
          segments.push({ x1: bottom.x, y1: bottom.y, x2: left.x, y2: left.y });
          break;
        case 11:
          segments.push({ x1: right.x, y1: right.y, x2: bottom.x, y2: bottom.y });
          break;
        case 12:
          segments.push({ x1: left.x, y1: left.y, x2: right.x, y2: right.y });
          break;
        case 13:
          segments.push({ x1: top.x, y1: top.y, x2: right.x, y2: right.y });
          break;
        case 14:
          segments.push({ x1: left.x, y1: left.y, x2: top.x, y2: top.y });
          break;
        default:
          break;
      }
    }
  }
  return segments;
};

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export const buildOrderedLoopsFromSegments = (
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>
) => {
  const adjacency = new Map<string, Array<{ to: string; dx: number; dy: number; angle: number }>>();
  const addEdge = (from: string, to: string, dx: number, dy: number) => {
    const list = adjacency.get(from) || [];
    list.push({ to, dx, dy, angle: Math.atan2(dy, dx) });
    adjacency.set(from, list);
  };
  segments.forEach((seg) => {
    const a = `${seg.x1},${seg.y1}`;
    const b = `${seg.x2},${seg.y2}`;
    addEdge(a, b, seg.x2 - seg.x1, seg.y2 - seg.y1);
    addEdge(b, a, seg.x1 - seg.x2, seg.y1 - seg.y2);
  });
  const visited = new Set<string>();
  const loops: Array<OutlinePoint[]> = [];

  const toPoint = (key: string) => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
  };

  adjacency.forEach((edges, start) => {
    edges.forEach((edge) => {
      const firstKey = edgeKey(start, edge.to);
      if (visited.has(firstKey)) return;
      const points: OutlinePoint[] = [toPoint(start)];
      let prev = start;
      let current = edge.to;
      let prevAngle = edge.angle;
      visited.add(firstKey);
      let safety = 0;
      while (safety < 200000) {
        safety += 1;
        points.push(toPoint(current));
        if (current === start) break;
        const candidates = adjacency.get(current) || [];
        let best: { to: string; angle: number } | null = null;
        let bestDelta = Infinity;
        for (const candidate of candidates) {
          if (candidate.to === prev) continue;
          const key = edgeKey(current, candidate.to);
          if (visited.has(key)) continue;
          const delta = (candidate.angle - prevAngle + Math.PI * 2) % (Math.PI * 2);
          if (delta < bestDelta) {
            bestDelta = delta;
            best = candidate;
          }
        }
        if (!best) break;
        visited.add(edgeKey(current, best.to));
        prev = current;
        current = best.to;
        prevAngle = best.angle;
      }
      if (points.length > 2) {
        loops.push(points);
      }
    });
  });
  return loops;
};

export const computeLoopLength = (points: OutlinePoint[]) => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    total += Math.hypot(dx, dy);
  }
  return total;
};

export const computeLoopArea = (points: OutlinePoint[]) => {
  let area = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    area += points[i].x * points[i + 1].y - points[i + 1].x * points[i].y;
  }
  return area / 2;
};

export const selectOuterLoop = (loops: OutlinePoint[][]) => {
  if (!loops.length) return null;
  let best = loops[0];
  let bestArea = Math.abs(computeLoopArea(best));
  for (let i = 1; i < loops.length; i += 1) {
    const area = Math.abs(computeLoopArea(loops[i]));
    if (area > bestArea) {
      bestArea = area;
      best = loops[i];
    }
  }
  return best;
};

export const normalizeDashPattern = (totalLength: number, width: number, scale: DashScale = defaultDashScale) => {
  const dashLength = width * scale.dash;
  const gapLength = width * scale.gap;
  const segmentCount = Math.max(1, Math.round(totalLength / (dashLength + gapLength)));
  const adjustedDash = totalLength / segmentCount - gapLength;
  if (adjustedDash <= 0 || totalLength < dashLength + gapLength) {
    return null;
  }
  return { dash: adjustedDash, gap: gapLength };
};
