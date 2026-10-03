// Fictitious people and stable sprite indices. Each call returns fresh mutable records.
const names = [
  'Mira Belle',
  'Kai Serschnitt',
  'Anna Nass',
  'Rainer Zufall',
  'Klara Fall',
  'Peter Silie',
  'Ella Fant',
  'Axel Schweiß',
  'Rosa Rot',
  'Ali Gator',
  'Anna Conda',
  'Frank Reich',
  'Marie Nade',
  'Tim Buktu',
  'Sara Zene',
  'Diether Moskanne',
  'Claire Anlage',
  'Albert Ross',
  'Polly Zei',
  'Ernst Haft',
  'Vera Nstaltung',
  'Lars Vegas',
  'Caro Tte',
  'Klaus Ur',
];
export const colors = ['#526d70', '#7b6257', '#626c88', '#6d6382', '#567764', '#8b7050'];
export const demoPeople = () =>
  names.map((name, id) => {
    const [first, last] = name.split(' ');
    return {
      id,
      first,
      last,

      companyInfo: {
        name: ['Musterwerk GmbH', 'Beispieltechnik AG', 'Lernwerkstatt OHG', 'Demo-Handel KG'][
          id % 4
        ],
        short: ['Musterwerk', 'Beispieltechnik', 'Lernwerkstatt', 'Demo-Handel'][id % 4],
        city: 'Musterstadt',
        active: true,
      },
      color: colors[id % colors.length],
      demoPortrait: id,
      // Authored groups for fictional characters, never inferred from uploaded photos.
      learningGroup: id % 2 === 0 ? 'demo-feminine' : 'demo-masculine',
    };
  });
