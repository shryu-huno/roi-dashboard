"use client";

import { useState } from "react";

type Team = { id: string; name: string };
type Part = { id: string; name: string; teamId: string };

// 팀·파트 드롭다운 한 쌍. 파트는 선택한 팀의 것만 보이고, 팀을 바꾸면 파트 선택이 초기화된다.
// (서버 applyApproval도 파트가 선택한 팀 소속인지 다시 검증한다.)
//
// 두 select는 값을 직접 쥐지 않는(uncontrolled, defaultValue) 방식이다. React 19는 form action이 끝나면
// 폼을 자동 초기화하는데, controlled select는 그때 DOM만 첫 옵션("팀 없음"/"파트 없음")으로 돌아가
// 저장된 값과 화면이 어긋난다. uncontrolled면 초기화 후에도 방금 저장돼 내려온 defaultValue가 보인다.
// 팀 state는 파트 목록을 거르는 용도로만 쓴다.
export function TeamPartFields({
  teams, parts, defaultTeamId, defaultPartId,
}: {
  teams: Team[]; parts: Part[]; defaultTeamId: string; defaultPartId: string;
}) {
  const [teamId, setTeamId] = useState(defaultTeamId);
  const teamParts = parts.filter((p) => p.teamId === teamId);
  const selectClass = "rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-primary)] disabled:opacity-50";

  return (
    <>
      {/* 팀은 팀 관리자·PM·파트장에게 의미가 있다(최고관리자·정산담당자는 전체 접근이라 무시됨). */}
      <select
        name="teamId"
        defaultValue={defaultTeamId}
        onChange={(e) => setTeamId(e.target.value)}
        className={selectClass}
      >
        <option value="">팀 없음</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {/* 파트: 선택한 팀의 파트만. 팀이 바뀌면 key가 바뀌어 파트 선택이 초기화된다. */}
      <select
        key={teamId}
        name="partId"
        defaultValue={teamId === defaultTeamId ? defaultPartId : ""}
        disabled={!teamId}
        className={selectClass}
      >
        <option value="">파트 없음</option>
        {teamParts.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </>
  );
}
