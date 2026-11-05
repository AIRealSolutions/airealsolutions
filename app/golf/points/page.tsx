import { getRoster, getSettings, golfRead, type Course } from "../lib/api";
import PointsScorecard from "./PointsScorecard";
import styles from "../golf.module.css";

export const metadata = {
  title: "Team Points scorecard",
  description: "Black Belt vs White Belt: best ball, birdies, sand saves and closest to the hole.",
};

export default async function PointsPage() {
  const [courses, settings, roster] = await Promise.all([
    golfRead<Course[]>("golf_courses", {}, [], 300),
    getSettings(),
    getRoster(),
  ]);
  return (
    <div className={styles.wrap}>
      {!settings.games.points.enabled && (
        <p className={styles.error} style={{ maxWidth: 640, margin: "0 auto 16px" }}>
          This game is turned off right now. You can still finish and post a card you already started.
        </p>
      )}
      <PointsScorecard courses={courses} settings={settings} roster={roster} />
    </div>
  );
}
