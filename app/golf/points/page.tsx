import { getPlayerStats, getRoster, getSettings, golfRead, type Course } from "../lib/api";
import { getPin } from "../lib/pin";
import PointsScorecard from "./PointsScorecard";
import styles from "../golf.module.css";

export const metadata = {
  title: "Dots scorecard",
  description: "Black Belt vs White Belt: best ball, birdies, sand saves and closest to the hole.",
};

export default async function PointsPage() {
  const pin = await getPin();
  const [courses, settings, roster, stats] = await Promise.all([
    golfRead<Course[]>("golf_courses", { p_pin: pin }, [], 300),
    getSettings(),
    getRoster(pin),
    getPlayerStats(pin),
  ]);
  return (
    <div className={styles.wrap}>
      {!settings.games.points.enabled && (
        <p className={styles.error} style={{ maxWidth: 640, margin: "0 auto 16px" }}>
          This game is turned off right now. You can still finish and post a card you already started.
        </p>
      )}
      <PointsScorecard courses={courses} settings={settings} roster={roster} stats={stats} pin={pin} />
    </div>
  );
}
