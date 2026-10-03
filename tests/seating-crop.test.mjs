import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cropSeatSnapshot } from '../public/seating-export.mjs';
test('print crop removes outer whitespace without altering the plan or internal gaps', () => {
  const input = {
    width: 4000,
    height: 5000,
    board: { x: 500, y: 2500, w: 480, h: 40 },
    teacher: { x: 600, y: 2400, w: 200, h: 56 },
    desks: [
      {
        box: { x: 300, y: 1200, w: 260, h: 186 },
        slots: [
          {
            box: { x: 310, y: 1230, w: 110, h: 130 },
            face: { x: 320, y: 1240, w: 60, h: 60 },
            name: { x: 320, y: 1300, w: 90, h: 30 },
          },
        ],
      },
    ],
  };
  const copy = structuredClone(input),
    out = cropSeatSnapshot(input);
  assert.deepEqual(input, copy);
  assert.equal(out.width, 680);
  assert.equal(out.height, 1340);
  assert.equal(out.desks[0].box.y, 0);
  assert.equal(out.desks[0].slots[0].face.y, 40);
  assert.equal(out.teacher.y - out.desks[0].box.y, 1200);
});
