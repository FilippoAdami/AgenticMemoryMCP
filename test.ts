async function main() {
  console.log("=== Sending Request ===");
  const res = await fetch('http://localhost:3000/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Who scored the goals in the match Portugal vs Uzbekistan on June 23 2026?' })
  });
  const data = await res.json();
  console.log("RESPONSE 1:", JSON.stringify(data, null, 2));

  if (data.status === 'WAITING_FOR_USER_PLAN_APPROVAL') {
    const sessionId = data.sessionId;
    console.log("\n=== Testing TWEAK Intent ===");
    const res2 = await fetch('http://localhost:3000/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Make sure you search for the timeline of events or match highlights instead of just score.', sessionId })
    });
    const data2 = await res2.json();
    console.log("RESPONSE 2:", JSON.stringify(data2, null, 2));
  }
}
main().catch(console.error);
