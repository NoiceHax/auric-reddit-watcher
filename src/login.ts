// One-off helper: opens the persistent browser profile and waits for a Reddit
// login, without starting the poll loop. Useful for re-authenticating after a
// session expires:  docker compose exec auric-reddit-watcher npm run login
import { ensureLoggedIn, closeBrowser } from "./reddit";

ensureLoggedIn()
  .then(() => {
    console.log("Reddit session stored in the browser profile.");
    return closeBrowser();
  })
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("Login failed:", err);
    await closeBrowser();
    process.exit(1);
  });
