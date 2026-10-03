// Canvas renderer consumes a snapshot; it never reads application state or sends data.
export function cropSeatSnapshot(input) {
  const snapshot = structuredClone(input);
  const boxes = [snapshot.board, snapshot.teacher, ...snapshot.desks.map((d) => d.box)];
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  snapshot.width = Math.max(...boxes.map((b) => b.x + b.w)) - left;
  snapshot.height = Math.max(...boxes.map((b) => b.y + b.h)) - top;
  const shift = (b) => {
    if (b) {
      b.x -= left;
      b.y -= top;
    }
  };
  shift(snapshot.board);
  shift(snapshot.teacher);
  for (const desk of snapshot.desks) {
    shift(desk.box);
    for (const slot of desk.slots) {
      shift(slot.box);
      shift(slot.face);
      shift(slot.name);
      shift(slot.companyBox);
    }
  }
  return snapshot;
}
export function drawSeatExport(input, images, source) {
  const snapshot = cropSeatSnapshot(input);
  const width = snapshot.width + 48,
    header = 116,
    pad = 24;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '18px sans-serif';
  const lines = [];
  let line = '';
  for (const name of snapshot.unplaced) {
    const next = line ? line + ' · ' + name : name;
    if (measure.measureText(next).width > width - 60 && line) {
      lines.push(line);
      line = name;
    } else line = next;
  }
  if (line) lines.push(line);
  const height = header + snapshot.height + 72 + (lines.length ? 34 + lines.length * 25 : 0),
    factor = Math.min(2, 4096 / Math.max(width, height), Math.sqrt(12000000 / (width * height)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * factor);
  canvas.height = Math.ceil(height * factor);
  const ctx = canvas.getContext('2d');
  ctx.scale(factor, factor);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';
  const text = (value, x, y, max, size = 16, bold = false, color = '#24333e', align = 'left') => {
    ctx.font = `${bold ? '700' : '400'} ${size}px sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(value, x, y, max);
  };
  const box = (r, color, stroke = null) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 8);
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  text('Sitzplan · ' + snapshot.className, 24, 34, width - 48, 30, true);
  text(snapshot.planName + ' · Lehrkraftansicht', 24, 69, width - 48, 18);
  text(
    snapshot.count + ' Schüler' + (snapshot.note ? ' · ' + snapshot.note : ''),
    24,
    95,
    width - 48,
    16,
    false,
    '#586570',
  );
  ctx.save();
  ctx.translate(pad, header);
  for (const desk of snapshot.desks) {
    box(desk.box, '#e3e9ee', '#aab9c6');
    text(
      desk.label,
      desk.box.x + desk.box.w / 2,
      desk.box.y + 16,
      desk.box.w - 20,
      13,
      true,
      '#24333e',
      'center',
    );
    for (const slot of desk.slots) {
      box(slot.box, '#ffffff');
      if (!slot.person) {
        text(
          'Freier Platz',
          slot.box.x + slot.box.w / 2,
          slot.box.y + slot.box.h / 2,
          slot.box.w - 16,
          14,
          false,
          '#24333e',
          'center',
        );
        continue;
      }
      const p = slot.person,
        img = images.get(source(p)),
        f = slot.face;
      ctx.save();
      ctx.beginPath();
      ctx.arc(f.x + f.w / 2, f.y + f.h / 2, Math.min(f.w, f.h) / 2, 0, Math.PI * 2);
      ctx.clip();
      if (img) {
        if (!p.photo && Number.isInteger(p.demoPortrait)) {
          const sw = img.naturalWidth / 6,
            sh = img.naturalHeight / 4;
          ctx.drawImage(
            img,
            (p.demoPortrait % 6) * sw,
            Math.floor(p.demoPortrait / 6) * sh,
            sw,
            sh,
            f.x,
            f.y,
            f.w,
            f.h,
          );
        } else {
          const side = Math.min(img.naturalWidth, img.naturalHeight);
          ctx.drawImage(
            img,
            (img.naturalWidth - side) / 2,
            (img.naturalHeight - side) / 2,
            side,
            side,
            f.x,
            f.y,
            f.w,
            f.h,
          );
        }
      } else {
        ctx.fillStyle = '#e4e8ec';
        ctx.fillRect(f.x, f.y, f.w, f.h);
        text((p.first[0] || '') + (p.last[0] || ''), f.x + 12, f.y + f.h / 2, f.w - 24, 24, true);
      }
      ctx.restore();
      const n = slot.name,
        align = slot.nameAlign === 'center' ? 'center' : 'left',
        x = align === 'center' ? n.x + n.w / 2 : n.x + 2;
      text(p.first, x, n.y + 7, n.w - 4, p.company ? 12 : 18, true, '#24333e', align);
      text(
        p.last,
        x,
        n.y + (p.company ? 19 : 25),
        n.w - 4,
        p.company ? 10 : 16,
        false,
        '#24333e',
        align,
      );
      if (p.company && slot.companyBox) {
        const c = slot.companyBox;
        text(
          p.company,
          align === 'center' ? c.x + c.w / 2 : c.x,
          c.y + c.h / 2,
          c.w,
          9,
          false,
          '#586570',
          align,
        );
      }
      const labels = [slot.pinned ? 'Fixiert' : '', slot.absent ? 'Abwesend' : '']
        .filter(Boolean)
        .join(' · ');
      if (labels)
        text(
          labels,
          slot.box.x + 4,
          slot.box.y + slot.box.h + 10,
          slot.box.w - 8,
          10,
          false,
          '#586570',
        );
    }
  }
  box(snapshot.teacher, '#c4d1dc', '#aab9c6');
  text(
    'Lehrkraft',
    snapshot.teacher.x + snapshot.teacher.w / 2,
    snapshot.teacher.y + snapshot.teacher.h / 2,
    snapshot.teacher.w - 28,
    17,
    true,
    '#24333e',
    'center',
  );
  box(snapshot.board, '#426753');
  text(
    'Tafel / Projektionsfläche',
    snapshot.board.x + snapshot.board.w / 2,
    snapshot.board.y + snapshot.board.h / 2,
    snapshot.board.w - 24,
    17,
    true,
    '#ffffff',
    'center',
  );
  ctx.restore();
  let y = header + snapshot.height + 25;
  if (lines.length) {
    text('Noch ohne Platz (' + snapshot.unplaced.length + ')', 24, y, width - 48, 18, true);
    y += 29;
    for (const l of lines) {
      text(l, 24, y, width - 48, 18);
      y += 25;
    }
  }
  text(
    'KlassenTools · BBS Einbeck · ' + snapshot.date,
    24,
    height - 20,
    width - 48,
    14,
    false,
    '#586570',
  );
  return {
    canvas,
    data: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    missing: images.size - [...images.values()].filter(Boolean).length,
  };
}
