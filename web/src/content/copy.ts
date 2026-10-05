/** Page copy and external links. No m-dashes. */

export const LINKS = {
  lampDwell:
    'https://github.com/mbta/lamp/blob/main/src/lamp_py/performance_manager/README.md',
  lampDictionary: 'https://github.com/mbta/lamp/blob/main/Data_Dictionary.md',
  lampOtp:
    'https://performancedata.mbta.com/lamp/subway-on-time-performance-v1/index.csv',
  wbur: 'https://www.wbur.org/news/2024/12/18/green-line-c-branch-stops-removal-kent-brandon-hall-fairbanks-newsletter',
  streetsblog:
    'https://mass.streetsblog.org/2024/12/17/mbtas-green-line-accessibility-project-will-consolidate-stops-in-brookline',
  gtfsArchive: 'https://cdn.mbta.com/archive/archived_feeds.txt',
  ridership:
    'https://www.arcgis.com/home/item.html?id=6494749a29c648018820d0e49636205c',
  stopthestop: 'https://stopthestop.com',
  stopthestopData: 'https://github.com/WoshuaJolk/stopthestop-data',
  stopthestopMethod:
    'https://github.com/WoshuaJolk/stopthestop-data/blob/main/docs/methodology.md',
};

export const MODE_LABELS = {
  green: 'Green Line',
  subway: 'Red, Orange, Blue',
  all: 'All',
} as const;

export const SOURCE_LABELS = {
  measured: 'Measured dwell + braking',
  dwell: 'Measured dwell only',
  flat: 'Same for every stop',
} as const;

export const SOURCE_HELP = {
  measured:
    'Median LAMP dwell at each platform and hour band, plus the time lost braking into the stop and pulling away, from a kinematic model at 1.3 m/s².',
  dwell:
    'Median LAMP dwell only. LAMP dwell already runs from the first "stopped" ping to the first "moving" ping, so it overlaps braking and pulling out; this drops the kinematic part to avoid counting that twice.',
  flat: 'One stop cost for every stop, like stopthestop. MBTA’s own "30 to 60 seconds faster" for two fewer C-branch stops implies 15 to 30 s per stop.',
} as const;

export const COPY = {
  title: 'Stahp the stahp',
  learnMore: 'How this works',
  inspired: 'Inspired by stopthestop.com',
  hideLearnMore: 'Back to the list',
  searchPlaceholder: 'Find your stop (e.g. Kent Street)',
  sortBest: 'Most time saved first',
  sortWorst: 'Most time lost first',
  settings: 'Settings',
  axisLabel: 'saved / day',
  hrs: 'hrs',

  settingsCost: 'Time each stop costs a passing rider',
  settingsFlat: 'Flat stop cost',
  settingsWeight: 'Walking penalty (vs. riding)',
  settingsSpeed: 'Walking speed',
  dwellNote:
    'How long does a stop take? The MBTA measures dwell in LAMP as the time between a train’s first "stopped" and first "moving" GPS ping at a platform. Our measured stop costs average about 61 s on the Green Line, 1.6 to 4 times what MBTA’s own C-branch estimate implies, so we let you pick.',
  dwellLinks: [
    ['LAMP dwell and travel time definitions', 'lampDwell'],
    ['LAMP data dictionary', 'lampDictionary'],
    ['MBTA C-branch estimate (WBUR)', 'wbur'],
    ['(Streetsblog)', 'streetsblog'],
  ] as const,

  flags: {
    hub: 'Transfer or junction',
    accessible: 'Accessible',
    notAccessible: 'Not accessible',
    cost_gap: 'Missing stop cost for some hours',
    stopCost: 'Stop cost per passing rider',
  },

  detail: {
    close: 'Close',
    a: 'Stopping vs. skipping',
    aBody:
      'Two trains leave the previous stop together. One stops here, one runs through. The gap when they reach the next stop is what every rider on board pays for this stop. Speeds come from LAMP travel times; the clock runs eight times faster than real time.',
    aStops: (n: string) => `Stops at ${n}`,
    aSkips: (n: string) => `Skips ${n}`,
    b: 'Riders at this stop and its neighbours, per weekday',
    bBody:
      'Dark is people getting on or off, the ones who would have to walk. Grey is people riding through, the ones who would save time.',
    bUsed: 'Get on or off',
    bThrough: 'Ride through',
    c: 'Riders by hour',
    cBody:
      'Each direction separately. Through riders are counted on the train as it leaves; the stop cost is paid once per through rider, every hour.',
    d: 'The trade',
    dBody:
      'Hours saved on trains against hours spent walking, weighted by the walking penalty.',
    dSaved: 'Saved on trains',
    dWalk: 'Extra walking (weighted)',
    dNet: 'Net',
    e: 'Where the riders walk',
    eBody:
      'Riders are spread evenly along the line between the midpoints to the neighbouring stops. If this stop closes, each walks to the nearest one left. The average extra walk is prev × next / (prev + next).',
    f: 'Stop cost by time of day',
    fBody:
      'Median measured dwell plus braking and pulling away, per direction and hour band. The dashed line is the stop cost the ranking uses right now.',
    fDwell: 'Dwell',
    fAccel: 'Braking and pulling away',
    g: 'Does it hold up?',
    gBody:
      'Net hours for this stop as the two big assumptions change. Blue cells keep the stop, red cells cut it. The first column uses the measured stop cost.',
  },

  network: {
    intro:
      'Every number on this page comes from public MBTA data and a few lines of arithmetic. For each stop we add up the seconds it costs everyone riding through it and subtract the extra walking for everyone who uses it.',
    how: 'How the score works',
    howBody: [
      'Through riders × stop cost = hours saved on trains if the stop goes. A stop cost is the time a passing rider spends on it: dwell at the platform plus the time lost braking in and pulling away.',
      'Riders who get on or off × their extra walk ÷ walking speed × walking penalty = hours lost walking. Walking counts double by default because waiting and walking feel slower than riding.',
      'Net = saved − walked. Positive means riders as a whole would be better off without the stop. Terminals are left out; transfer stops and junctions are scored but flagged.',
    ],
    swarm: 'Every stop, by net hours per weekday',
    swarmBody:
      'Each dot is a stop, sized by riders passing through. Right of zero, closing it helps; left of zero, it hurts, and that side is compressed so the busiest stops fit.',
    strips: 'Along each line',
    stripsBody:
      'Stops placed by distance along the track and coloured by net hours. Stops packed close together on the surface branches tend to come out red.',
    grid: 'How many stops would be worth closing?',
    gridBody:
      'Stops with positive net hours, and their total, as stop cost and walking penalty change. The first column is the measured stop cost.',
    scatter: 'Dwell vs. riders per train',
    scatterBody:
      'Each dot is a platform in one direction. Even where about one person gets on or off per train, trains still sit for 30 s or more. Some of that is real (doors, fare payment, operator checks), some is how LAMP times a stop.',
    scatterX: 'riders getting on or off per train',
    scatterY: 'median dwell (s)',
    scatterFit: (a: number, b: number) =>
      `Fit: ${a.toFixed(0)} s + ${b.toFixed(1)} s per rider`,
    hist: 'How long trains dwell',
    histBody:
      'Every measured weekday stop event in the LAMP sample, by line. The median is marked.',
    usage: 'Used vs. passed through',
    usageBody:
      'Daily riders getting on or off against riders passing through. Stops in the lower right are the ones a lot of people ride past and few use.',
    usageX: 'riders passing through per weekday',
    usageY: 'riders getting on or off per weekday',
    mbta: 'Our numbers vs. the MBTA’s C-branch estimate',
    mbtaBody:
      'The MBTA is closing Kent Street and merging Brandon Hall and Fairbanks Street. It says trips will be "30 to 60 seconds faster" for the two stops removed, about 15 to 30 s each. Here is what each stop costs a passing rider under the current setting, per direction.',
    mbtaBand: 'MBTA implied, per stop',
    caveats: 'Why this may be wrong',
    caveatsBody:
      'Direction of the bias in brackets: [+] makes removal look better than it is, [−] worse, [?] unknown.',
    sources: 'Sources',
  },
};

export const CAVEATS: [string, string][] = [
  [
    '+',
    'LAMP dwell starts at the first "stopped" ping and ends at the first "moving" ping, so it overlaps braking and pulling out, which the kinematic model counts again. Use "Measured dwell only" to drop the overlap.',
  ],
  [
    '+',
    'About 40 s per stop shows up even with one rider per train. Only the part that is real time at the platform goes away with the stop.',
  ],
  [
    '+',
    'Street-running trains that skip a stop can still hit the same red light, so part of the saving is lost.',
  ],
  [
    '+',
    'Every through rider gets the full stop cost, as if every train stopped every time.',
  ],
  [
    '+',
    'Riders who switch to a bus, a parallel branch or stop riding are counted as walking. Lost riders are a real cost the model does not price.',
  ],
  [
    '−',
    'Fewer stops also make run times more reliable and can mean more frequent service with the same trains. Not counted.',
  ],
  [
    '−',
    'Hills, winter, wide streets and mobility limits make a 2× walking penalty look low for some riders. Accessibility is flagged, not scored.',
  ],
  [
    '?',
    'Fall 2025 ons, offs and flow are MBTA model estimates, not counts. Surface Green Line boardings through the rear doors are the weakest part of the data.',
  ],
  [
    '?',
    'The walk is on a straight line between stops, with riders spread evenly. Real walksheds are two-dimensional and follow streets.',
  ],
  [
    '?',
    'No routing: no missed or made connections, no transfers. Stops are scored one at a time, so closing two neighbours is not the sum of the two.',
  ],
  ['?', 'One season of data, weekdays only.'],
];

export const SOURCES: [string, keyof typeof LINKS][] = [
  [
    'Ridership: MBTA Fall 2025 rail ridership by hour, route and stop',
    'ridership',
  ],
  ['Stop events and dwell: MBTA LAMP subway on-time performance', 'lampOtp'],
  ['Stops and track geometry: MBTA GTFS archive, 2025-10-14', 'gtfsArchive'],
  ['Design and method after stopthestop.com', 'stopthestop'],
  ['stopthestop-data (MIT)', 'stopthestopData'],
];
