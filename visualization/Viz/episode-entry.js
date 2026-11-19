// Public links use the current sheet ID; internal mini scenes name an orbital asset.
import { loadCurrentEpisodes } from "../../shared/episode-feed.js?v=5";
import { installEpisodeNavigation } from "../../shared/episode-navigation.js?v=2";
const query = new URLSearchParams(location.search);
const publicId = query.get("episode") || "E-001";
let episodeId = query.get("asset");
if (!episodeId) {
  try {
    const feed = await loadCurrentEpisodes();
    episodeId = feed.episodes.find(row => row["Episode ID"] === publicId)?.ID;
  } catch (error) {
    document.getElementById("episodeTitle").textContent = `Current episode information unavailable: ${error.message}`;
    const boot = document.getElementById("episodeBootText");
    if (boot) boot.textContent = `Could not load episode: ${error.message}`;
    throw error;
  }
}
const episodeModule = {
  "E-001": "./compare.js?v=20", "E-002": "./episode-e002.js?v=8",
  "E-005": "./episode-e005.js?v=11", "E-003": "./episode-e003.js?v=6",
  "E-006": "./episode-e006.js?v=13", "E-008": "./episode-e008.js?v=5",
  "E-016": "./episode-e016.js?v=3", "E-059": "./episode-e059.js?v=4",
}[episodeId];
if (episodeModule) import(episodeModule).then(async () => {
  if (query.get("mini") === "1") return;
  try {
    const { episodes } = await loadCurrentEpisodes();
    installEpisodeNavigation(document.querySelector("#episodeFocus"), episodes, episodeId, { review: query.get("dev") === "1", period: episodeId !== "E-002" });
  } catch (error) { console.warn("Episode navigation unavailable", error); }
}).catch(error => {
  console.error(error);
  const boot = document.getElementById("episodeBootText");
  if (boot) boot.textContent = `Could not load episode: ${error.message}`;
});
else document.getElementById("episodeTitle").textContent = `${publicId}: visualization unavailable`;
