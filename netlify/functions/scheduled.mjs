// Netlify Scheduled Function: every 10 minutes it moves overdue tasks onto today (once a day),
// pulls new leads from Gmail and sends anything waiting to Google Calendar.
// Listed here so Netlify packages these libraries with the function (the server code loads them).
import '@netlify/blobs';
import 'sql.js';
import core from '../../server/handler.js';

process.env.PARKPILOT_STORE = process.env.PARKPILOT_STORE || 'netlify';

export default async () => {
  const r = await core.runScheduled();
  console.log('ParkPilot CRM scheduled run:', JSON.stringify(r));
};

export const config = { schedule: '*/10 * * * *' };
