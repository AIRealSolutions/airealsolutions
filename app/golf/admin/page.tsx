import AdminPanel from "./AdminPanel";
import styles from "../golf.module.css";

export const metadata = {
  title: "Control panel",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <div className={styles.wrap}>
      <AdminPanel />
    </div>
  );
}
