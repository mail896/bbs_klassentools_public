import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrangeSeats,
  rotateSeat,
  moveSeat,
  snapSeat,
  compactSeatRoom,
  seatDimensions,
  seatRoomWidth,
  seatRoomHeight,
  seatDisplay,
} from '../public/seating-layout.mjs';

test('U and row layouts remain nonoverlapping, bounded and reversible from teacher perspective', () => {
  for (const count of [0, 1, 4, 12, 16, 31])
    for (const layout of ['u', 'rows'])
      for (const rows of [2, 3, 6]) {
        const plan = {
          rows,
          teacher: { x: 500, y: 80 },
          tables: Array.from({ length: count }, (_, i) => ({ slots: [i] })),
        };
        arrangeSeats(plan, layout);
        const boxes = plan.tables.map((t) => ({ ...t, ...seatDimensions(t) }));
        for (const [i, box] of boxes.entries()) {
          assert.ok(box.x >= 0 && box.x + box.w <= seatRoomWidth(plan));
          assert.ok(box.y >= 0 && box.y + box.h <= seatRoomHeight(plan));
          const projected = seatDisplay(box, box.w, box.h, plan);
          assert.deepEqual(seatDisplay(projected, box.w, box.h, plan), { x: box.x, y: box.y });
          for (const other of boxes.slice(i + 1))
            assert.ok(
              box.x + box.w <= other.x ||
                other.x + other.w <= box.x ||
                box.y + box.h <= other.y ||
                other.y + other.h <= box.y,
            );
        }
        assert.deepEqual(
          plan.tables.flatMap((t) => t.slots),
          Array.from({ length: count }, (_, i) => i),
        );
        assert.ok(plan.tables.every((t) => (layout === 'rows' ? !t.vertical : true)));
      }
});

test('desk rotation retains occupants, centre and valid boundary coordinates', () => {
  const table = { x: 400, y: 400, slots: ['one', 'two'], vertical: false };
  rotateSeat(table);
  assert.deepEqual(table, { x: 437, y: 353, slots: ['one', 'two'], vertical: true });
  rotateSeat(table);
  assert.deepEqual(table, { x: 400, y: 400, slots: ['one', 'two'], vertical: false });
  const edge = { x: 0, y: 60, vertical: true, slots: [null] };
  rotateSeat(edge);
  assert.ok(edge.x >= 0 && edge.y >= 60);
});

test('room grows across all edges without changing other desks relative positions', () => {
  for (const [x, y] of [
    [-300, 200],
    [1700, 200],
    [200, -300],
    [200, 1700],
  ]) {
    const plan = {
      teacher: { x: 500, y: 80 },
      tables: [
        { x: 100, y: 180, slots: ['a'] },
        { x: 400, y: 180, slots: ['b'] },
      ],
      room: { width: 1200, height: 700 },
    };
    const before = structuredClone(plan);
    const growth = moveSeat(plan, plan.tables[0], x, y);
    for (const [point, old, dims] of [
      [plan.tables[1], before.tables[1], { w: 260, h: 186 }],
      [plan.teacher, before.teacher, { w: 200, h: 56 }],
    ]) {
      const pos = seatDisplay(point, dims.w, dims.h, plan),
        prev = seatDisplay(old, dims.w, dims.h, before);
      assert.equal(pos.x - growth.left, prev.x);
      assert.equal(pos.y - growth.top, prev.y);
    }
    assert.ok(plan.room.width >= 1200 && plan.room.height >= 700);
    assert.ok(plan.tables.every((t) => t.x >= 0 && t.y >= 60));
    assert.deepEqual(
      plan.tables.map((t) => t.slots),
      [['a'], ['b']],
    );
  }
});

test('rotated desks align exactly despite non-grid coordinates', () => {
  const table = { x: 51, y: 500, vertical: true };
  const plan = { teacher: { x: 500, y: 80 }, tables: [table, { x: 40, y: 180, vertical: true }] };
  assert.equal(snapSeat(plan, table, 47, 500).x, 40);
  assert.equal(snapSeat(plan, table, 57, 500).x, 57);
  assert.equal(snapSeat(plan, table, 47, 500, 0).x, 47);
});

test('compacting a grown room preserves relative desk positions and occupants', () => {
  const plan = {
    teacher: { x: 800, y: 400 },
    tables: [{ x: 350, y: 500, vertical: true, slots: ['a', 'b'] }],
    room: { width: 4000, height: 5000 },
  };
  const before = structuredClone(plan);
  compactSeatRoom(plan);
  assert.ok(plan.room.width < before.room.width && plan.room.height < before.room.height);
  assert.equal(plan.teacher.x - plan.tables[0].x, before.teacher.x - before.tables[0].x);
  assert.equal(plan.teacher.y - plan.tables[0].y, before.teacher.y - before.tables[0].y);
  assert.deepEqual(plan.tables[0].slots, ['a', 'b']);
  const compact = structuredClone(plan);
  compactSeatRoom(plan);
  assert.deepEqual(plan, compact);
});
