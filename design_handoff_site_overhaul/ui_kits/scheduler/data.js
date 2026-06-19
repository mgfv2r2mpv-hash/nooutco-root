/* Fake schedule data for the SAssi UI kit. Mirrors the shape of the app's
   ScheduleData (clients, technicians, appointments) at a glance — no real PHI.
   Names are clearly fictional. Times are local-ISO-ish strings. */
(function () {
  const TYPE = {
    direct:       { key: 'client-session', label: 'Direct service',        accent: 'var(--type-direct)' },
    supervision:  { key: 'supervision',    label: 'Supervision',           accent: 'var(--type-supervision)' },
    parent:       { key: 'parent-training',label: 'Parent training / CoC', accent: 'var(--type-parent-training)' },
    reassess:     { key: 'reassessment',   label: 'Reassessment',          accent: 'var(--type-reassessment)' },
    planning:     { key: 'case-planning',  label: 'Case planning',         accent: 'var(--type-case-planning)' },
    admin:        { key: 'internal-task',  label: 'Admin work',            accent: 'var(--type-admin)' },
  };

  const clients = ['Theo R.', 'Mia L.', 'Sam D.', 'Ava P.'];
  const techs = ['Jordan B.', 'Priya N.', 'Devon K.'];

  // Day-of-month → list of appointments (for the current month grid demo).
  // status: 'scheduled' | 'completed' | 'canceled'; cancelSource for canceled.
  const appts = [
    { id: 'a1',  day: 2,  start: '9:00',  end: '11:00', type: 'direct',      client: 'Theo R.', tech: 'Jordan B.', status: 'completed' },
    { id: 'a2',  day: 2,  start: '13:00', end: '14:00', type: 'supervision', client: 'Theo R.', tech: 'Jordan B.', status: 'completed' },
    { id: 'a3',  day: 4,  start: '10:00', end: '12:00', type: 'direct',      client: 'Mia L.',  tech: 'Priya N.',  status: 'completed' },
    { id: 'a4',  day: 4,  start: '15:00', end: '16:00', type: 'parent',      client: 'Mia L.',  tech: 'Priya N.',  status: 'scheduled' },
    { id: 'a5',  day: 5,  start: '9:00',  end: '11:30', type: 'direct',      client: 'Sam D.',  tech: 'Devon K.',  status: 'completed' },
    { id: 'a6',  day: 9,  start: '9:00',  end: '11:00', type: 'direct',      client: 'Ava P.',  tech: 'Jordan B.', status: 'scheduled' },
    { id: 'a7',  day: 9,  start: '14:00', end: '15:00', type: 'planning',    client: 'Ava P.',  tech: '',          status: 'scheduled' },
    { id: 'a8',  day: 11, start: '10:00', end: '12:00', type: 'direct',      client: 'Theo R.', tech: 'Jordan B.', status: 'canceled', cancelSource: 'family' },
    { id: 'a9',  day: 12, start: '9:00',  end: '11:00', type: 'direct',      client: 'Mia L.',  tech: 'Priya N.',  status: 'scheduled' },
    { id: 'a10', day: 12, start: '13:00', end: '14:00', type: 'supervision', client: 'Mia L.',  tech: 'Priya N.',  status: 'scheduled' },
    { id: 'a11', day: 16, start: '9:00',  end: '11:30', type: 'direct',      client: 'Sam D.',  tech: 'Devon K.',  status: 'scheduled' },
    { id: 'a12', day: 16, start: '15:00', end: '16:00', type: 'reassess',    client: 'Sam D.',  tech: '',          status: 'scheduled' },
    { id: 'a13', day: 18, start: '10:00', end: '12:00', type: 'direct',      client: 'Ava P.',  tech: 'Jordan B.', status: 'canceled', cancelSource: 'staff' },
    { id: 'a14', day: 19, start: '9:00',  end: '11:00', type: 'direct',      client: 'Theo R.', tech: 'Jordan B.', status: 'scheduled' },
    { id: 'a15', day: 23, start: '9:00',  end: '11:00', type: 'direct',      client: 'Mia L.',  tech: 'Priya N.',  status: 'scheduled' },
    { id: 'a16', day: 23, start: '13:00', end: '14:00', type: 'parent',      client: 'Mia L.',  tech: 'Priya N.',  status: 'scheduled' },
    { id: 'a17', day: 25, start: '9:00',  end: '11:30', type: 'direct',      client: 'Sam D.',  tech: 'Devon K.',  status: 'scheduled' },
  ];

  // Compliance snapshot — per client (supervision %) and per tech (hours).
  const clientComp = [
    { name: 'Theo R.', pct: 38, target: 20, status: 'over' },
    { name: 'Mia L.',  pct: 14, target: 20, status: 'pace' },
    { name: 'Sam D.',  pct: 9,  target: 20, status: 'behind' },
    { name: 'Ava P.',  pct: 19, target: 20, status: 'met' },
  ];
  const techComp = [
    { name: 'Jordan B.', completed: 26, scheduled: 6, target: 30, status: 'met' },
    { name: 'Priya N.',  completed: 12, scheduled: 9, target: 30, status: 'pace' },
    { name: 'Devon K.',  completed: 8,  scheduled: 5, target: 30, status: 'behind' },
  ];

  window.SAssiData = { TYPE, clients, techs, appts, clientComp, techComp };
})();
