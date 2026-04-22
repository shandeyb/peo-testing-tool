// PEO NPA Testfest — Cloudflare Worker
// Receives test results from the HTML form and writes them to Notion.
//
// DEPLOY STEPS (5 min):
// 1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Create Worker
// 2. Replace the default code with this entire file → Save and Deploy
// 3. Go to Settings → Variables → Add variable:
//    Name:  NOTION_TOKEN
//    Value: your Notion integration token (secret_...)
// 4. Copy the Worker URL (e.g. https://peo-testfest.YOUR-NAME.workers.dev)
// 5. Paste it into index.html as the value of WORKER_URL

const NOTION_DB = 'f99b2563-bc95-44b3-b675-1ce329bef455'; // Test Results Log data source

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let items;
    try {
      const body = await request.json();
      items = Array.isArray(body) ? body : [body];
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    // Write each result as a row in the Notion database
    const writes = items.map(item => writeToNotion(item, env.NOTION_TOKEN));
    const responses = await Promise.allSettled(writes);

    const failed = responses.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      console.error('Some writes failed:', failed.map(f => f.reason));
      return json({ ok: false, error: 'Some rows failed to write', count: items.length - failed.length }, 500);
    }

    return json({ ok: true, count: items.length });
  },
};

async function writeToNotion(item, token) {
  const props = {
    'Test Case': {
      title: [{ text: { content: item.test_case || '' } }]
    },
    'Tester': {
      rich_text: [{ text: { content: item.tester || '' } }]
    },
    'Result': {
      select: { name: item.result }
    },
    'Role': {
      select: { name: item.role || 'Admin' }
    },
    'Notes / Bug Link': {
      rich_text: [{ text: { content: item.notes || '' } }]
    },
    'Expected Behavior': {
      rich_text: [{ text: { content: item.expected_behavior || '' } }]
    },
    'What Happened': {
      rich_text: [{ text: { content: [item.what_happened, item.screenshot_link].filter(Boolean).join('\n') || '' } }]
    },
  };

  if (item.company) {
    props['Company'] = { url: item.company };
  }

  if (item.date) {
    props['Date'] = { date: { start: item.date } };
  }

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DB },
      properties: props,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion error ${res.status}: ${err}`);
  }

  return res.json();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
