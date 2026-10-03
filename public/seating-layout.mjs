// Room geometry is independent of the DOM and of the displayed teacher perspective.
export function arrangeSeats(plan, layout) {
  delete plan.room;
  plan.layout = layout;
  const n = plan.tables.length,
    bottom = Math.min(4, n),
    sides = n - bottom,
    rows = Math.ceil(sides / 2);
  plan.tables.forEach((t, i) => {
    if (layout === 'rows') {
      const cols = Math.max(1, Math.ceil(n / (plan.rows || 3)));
      t.vertical = false;
      t.x = 40 + (i % cols) * 280;
      t.y = 180 + Math.floor(i / cols) * 220;
    } else if (i < sides) {
      t.vertical = true;
      t.x = i % 2 ? 974 : 40;
      t.y = 180 + Math.floor(i / 2) * 300;
    } else {
      t.vertical = false;
      t.x = 40 + (i - sides) * 280;
      t.y = 180 + rows * 300;
    }
  });
}
export function seatDimensions(t) {
  return t.vertical ? { w: 186, h: 280 } : { w: 260, h: 186 };
}
export function seatRoomWidth(plan) {
  return Math.max(
    plan.room?.width || 1200,
    plan.teacher.x + 240,
    ...plan.tables.map((t) => t.x + seatDimensions(t).w + 40),
  );
}
export function seatRoomHeight(plan) {
  return Math.max(
    plan.room?.height || 700,
    plan.teacher.y + 180,
    ...plan.tables.map((t) => t.y + seatDimensions(t).h + 60),
  );
}
export function seatDisplay(t, w, h, plan) {
  return { x: seatRoomWidth(plan) - t.x - w, y: seatRoomHeight(plan) - t.y - h };
}

// Keep the desk centre and its occupants; only clamp at the room's leading edges.
export function rotateSeat(table) {
  const before = seatDimensions(table);
  table.vertical = !table.vertical;
  const after = seatDimensions(table);
  table.x = Math.max(0, table.x + (before.w - after.w) / 2);
  table.y = Math.max(60, table.y + (before.h - after.h) / 2);
}

// Extend the room in any direction. Translating all stored points preserves their
// relative positions when a drag crosses the zero edge of the persisted coordinates.
export function moveSeat(plan, table, x, y) {
  const width = seatRoomWidth(plan),
    height = seatRoomHeight(plan);
  const others = [plan.teacher, ...plan.tables].filter((t) => t !== table);
  x = Math.min(
    30000,
    Math.max(-Math.min(31000 - width, 30000 - Math.max(0, ...others.map((t) => t.x))), x),
  );
  y = Math.min(
    30000,
    Math.max(60 - Math.min(31000 - height, 30000 - Math.max(60, ...others.map((t) => t.y))), y),
  );
  const sx = Math.max(0, -x),
    sy = Math.max(0, 60 - y);
  for (const point of others) {
    point.x += sx;
    point.y += sy;
  }
  table.x = x + sx;
  table.y = y + sy;
  plan.room = { width: width + sx, height: height + sy };
  plan.room = { width: seatRoomWidth(plan), height: seatRoomHeight(plan) };
  return { left: plan.room.width - width - sx, top: plan.room.height - height - sy };
}

// Snap matching edges, independently of desk orientation and the background grid.
export function snapSeat(plan, table, x, y, tolerance = 10) {
  const dims = table === plan.teacher ? { w: 200, h: 56 } : seatDimensions(table);
  const candidates = [plan.teacher, ...plan.tables].filter((t) => t !== table);
  const axis = (value, key, size) => {
    let best = value,
      distance = tolerance + 1;
    for (const other of candidates) {
      const d = other === plan.teacher ? { w: 200, h: 56 } : seatDimensions(other);
      for (const target of [other[key], other[key] + d[size] - dims[size]]) {
        const delta = Math.abs(value - target);
        if (delta <= tolerance && delta < distance) {
          best = target;
          distance = delta;
        }
      }
    }
    return Math.round(best);
  };
  return { x: axis(x, 'x', 'w'), y: axis(y, 'y', 'h') };
}

// Remove unused outer space, keeping every desk's position relative to the others.
export function compactSeatRoom(plan) {
  const points = [plan.teacher, ...plan.tables];
  const dx = Math.max(0, Math.min(...points.map((p) => p.x)) - 40);
  const dy = Math.max(0, Math.min(...points.map((p) => p.y)) - 80);
  for (const p of points) {
    p.x -= dx;
    p.y -= dy;
  }
  delete plan.room;
  plan.room = { width: seatRoomWidth(plan), height: seatRoomHeight(plan) };
}
