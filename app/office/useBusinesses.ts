"use client";

import { useCallback, useEffect, useState } from "react";
import { officeRest, type Business, type Entity } from "./lib/client";

const SELECT = "id,entity_id,name,slug,relationship,category,status,website,summary,weekly_focus,factory_project_id,sort_order";

/** Loads the LLC's entities and businesses; shared by the Office home and Businesses pages. */
export function useBusinesses() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setError("");
    try {
      const [b, e] = await Promise.all([
        officeRest<Business[]>(`office_businesses?select=${SELECT}&order=sort_order.asc,name.asc`),
        officeRest<Entity[]>("acct_entities?select=id,legal_name,short_name,state&order=legal_name.asc"),
      ]);
      setBusinesses(b);
      setEntities(e);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load businesses.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { businesses, setBusinesses, entities, loading, error, reload };
}
