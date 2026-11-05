import { getRoster, getSettings, golfRead, type Course } from "../lib/api";
import { getPin } from "../lib/pin";
import WolfScorecard from "./WolfScorecard";
import styles from "../golf.module.css";

export const metadata = {
  title: "Wolf scorecard",
  description: "Keep a Wolf scorecard on your phone with comments on every hole.",
};

export default async function WolfPage() {
  const pin = await getPin();
  const [courses, settings, roster] = await Promise.all([
    golfRead<Course[]>("golf_courses", { p_pin: pin }, [], 300),
    getSettings(),
    getRoster(pin),
  ]);
  return (
    <div className={styles.wrap}>
      {!settings.games.wolf.enabled && (
        <p className={styles.error} style={{ maxWidth: 640, margin: "0 auto 16px" }}>
          This game is turned off right now. You can still finish and post a card you already started.
        </p>
      )}
      <WolfScorecard courses={courses} settings={settings} roster={roster} pin={pin} />
    </div>
  );
}
