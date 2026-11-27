"use client";

import { createContext, useContext, useState } from "react";
import { UserEditPanel, type EditUser } from "./UserEditPanel";

type Team = { id: string; name: string };
type Part = { id: string; name: string; teamId: string };

// 편집 대상(드로어 열림)은 클라이언트 state로만 관리한다. 트리 선택(어느 팀·파트를 보는지)은
// URL 쿼리라 서로 독립적이다. 서버 렌더된 트리/헤더/표를 children으로 감싸고, 그 안의 행 버튼
// (EditUserButton)이 openEditor를 호출해 드로어를 연다.
const EditorCtx = createContext<{ openEditor: (u: EditUser) => void } | null>(null);

export function useEditor() {
  const c = useContext(EditorCtx);
  if (!c) throw new Error("useEditor must be used within UserAdminProvider");
  return c;
}

export function UserAdminProvider({
  teams, parts, children,
}: {
  teams: Team[];
  parts: Part[];
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState<EditUser | null>(null);
  return (
    <EditorCtx.Provider value={{ openEditor: setEditing }}>
      {children}
      <UserEditPanel editing={editing} teams={teams} parts={parts} onClose={() => setEditing(null)} />
    </EditorCtx.Provider>
  );
}
