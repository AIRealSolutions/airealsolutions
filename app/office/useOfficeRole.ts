"use client";

import { createContext, useContext } from "react";
import type { OfficeRole } from "./lib/client";

/** The signed-in person's Office role, provided by OfficeShell once the gate opens. */
export const OfficeRoleContext = createContext<OfficeRole>("owner");
export const useOfficeRole = () => useContext(OfficeRoleContext);
