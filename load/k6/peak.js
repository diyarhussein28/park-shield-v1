// US-45 capacity test (01-requirements §8): 200 alerts/s peak and 10,000 scans/min, open model.
//   npm run load:seed -- --vehicles 2000
//   k6 run load/k6/peak.js                       (local: API on :4000, web on :3000)
//   k6 run -e API=https://staging.parkshield.de -e WEB=https://staging-s.parkshield.de load/k6/peak.js
// Then: npm run load:report -- --since <start time printed by k6> --wait 120
//
// Every iteration uses its own User-Agent, i.e. it is a different scanner for the rate limits
// (02-architecture §5), exactly like many people scanning many cars. The limits stay switched on.
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';

const API = __ENV.API || 'http://127.0.0.1:4000';
const WEB = __ENV.WEB || 'http://127.0.0.1:3000';
const ALERTS_PER_S = Number(__ENV.ALERTS || 200);
const SCANS_PER_MIN = Number(__ENV.SCANS || 10000);
const DURATION = __ENV.DURATION || '60s';
const CAPTCHA = __ENV.CAPTCHA || 'dev-captcha-ok';

const codes = new SharedArray('codes', () => JSON.parse(open('../../.local/load/codes.json')));
// nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator -- load test picks a random decal
const pick = () => codes[Math.floor(Math.random() * codes.length)];
const TYPES = ['lights_on', 'window_open', 'alarm', 'blocking', 'towing_risk'];

export const options = {
  discardResponseBodies: true,
  scenarios: {
    alerts: {
      executor: 'constant-arrival-rate',
      exec: 'alert',
      rate: ALERTS_PER_S,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 100,
      maxVUs: 1000,
    },
    // The scanner page: most scans render the HTML page, which itself calls GET /v1/scan/:code.
    scans: {
      executor: 'constant-arrival-rate',
      exec: 'scan',
      rate: SCANS_PER_MIN,
      timeUnit: '1m',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 500,
    },
  },
  thresholds: {
    'http_req_failed{scenario:alerts}': ['rate<0.01'],
    'http_req_failed{scenario:scans}': ['rate<0.01'],
    'http_req_duration{scenario:alerts}': ['p(95)<800'],
    'http_req_duration{scenario:scans}': ['p(95)<1500'], // SC-12: scanner page < 1.5 s on 4G
    dropped_iterations: ['count<100'],
  },
};

export function setup() {
  // Warm connections and caches the way real traffic would before a peak.
  http.batch(Array.from({ length: 40 }, () => ['GET', `${API}/v1/scan/${pick()}`]));
  console.log(`START ${new Date().toISOString()}`);
}

export function alert() {
  const res = http.post(
    `${API}/v1/scan/${pick()}/alerts`,
    JSON.stringify({
      // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator -- load test picks a random alert type
      type: TYPES[Math.floor(Math.random() * TYPES.length)],
      captcha: CAPTCHA,
      lang: 'de',
    }),
    {
      headers: {
        'content-type': 'application/json',
        'user-agent': `Mozilla/5.0 (Linux; Android 15; k6-${__VU}-${__ITER}) Mobile Safari/537.36`,
      },
      tags: { name: 'POST /v1/scan/:code/alerts' },
    },
  );
  check(res, { 'alert created': (r) => r.status === 201 });
}

export function scan() {
  const res = http.get(`${WEB}/s/${pick()}`, {
    headers: { 'user-agent': `Mozilla/5.0 (iPhone; k6-${__VU}-${__ITER}) Mobile Safari/604.1` },
    tags: { name: 'GET /s/:code' },
  });
  check(res, { 'scanner page': (r) => r.status === 200 });
}
