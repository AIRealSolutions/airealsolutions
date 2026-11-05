import { golfRead, type Course } from "../lib/api";
import WolfScorecard from "./WolfScorecard";
import styles from "../golf.module.css";

export const metadata = {
  title: "Wolf scorecard",
  description: "Keep a Wolf scorecard on your phone with comments on every hole.",
};

export default async function WolfPage() {
  const courses = await golfRead<Course[]>("golf_courses", {}, [], 300);
  return (
    <div className={styles.wrap}>
      <WolfScorecard courses={courses} />
    </div>
  );
}
