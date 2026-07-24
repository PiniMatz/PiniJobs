import { upsertApplication, getApplication, addEvent, getUpcomingEvents, deleteApplication } from '../api/db.js';

async function run() {
  console.log("Starting Firebase connection test...");
  try {
    // 1. Create Application
    const appId = await upsertApplication({
      company: "Test Company Inc",
      role_title: "Staff Systems Engineer",
      source: "linkedin",
      status: "applied",
      notes: "This is a test application note"
    });
    console.log("Successfully created test application with ID:", appId);

    // 2. Add Event
    const eventId = await addEvent(appId, {
      type: "appointment",
      detail: "Test Recruiter Screen",
      due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 1 day from now
    });
    console.log("Successfully created event with ID:", eventId);

    // 3. Get Application and events
    const app = await getApplication(appId);
    console.log("Fetched application data:", JSON.stringify(app, null, 2));

    // 4. Get Upcoming Events
    const upcoming = await getUpcomingEvents();
    console.log("Fetched upcoming events count:", upcoming.length);

    // 5. Clean up
    console.log("Cleaning up test application...");
    await deleteApplication(appId);
    console.log("Cleanup complete!");
    console.log("Firebase connection test PASSED!");
  } catch (err) {
    console.error("Firebase connection test FAILED:", err);
  }
}

run();
