// Netlify Scheduled Function: every 10 minutes it moves overdue tasks onto today (once a day),
// checks Outlook for changes, sends anything waiting, and keeps live updates from Outlook switched on.
// Listed here so Netlify packages these libraries with the function (the server code loads them).
import '@netlify/blobs';
import 'sql.js';
import core from '../../server/handler.js';

process.env.COASTFIELDS_STORE = process.env.COASTFIELDS_STORE || 'netlify';

export default async () => {
  const r = await core.runScheduled();
  console.log('Coastfields scheduled run:', JSON.stringify(r));
};

export const config = { schedule: '*/10 * * * *' };
