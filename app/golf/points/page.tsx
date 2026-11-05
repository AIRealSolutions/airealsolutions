import { golfRead, type Course } from "../lib/api";
import PointsScorecard from "./PointsScorecard";
import styles from "../golf.module.css";

export const metadata = {
  title: "Team Points scorecard",
  description: "Black Belt vs White Belt: best ball, birdies, sand saves and closest to the hole.",
};

export default async function PointsPage() {
  const courses = await golfRead<Course[]>("golf_courses", {}, [], 300);
  return (
    <div className={styles.wrap}>
      <PointsScorecard courses={courses} />
    </div>
  );
}
