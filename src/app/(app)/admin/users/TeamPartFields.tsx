"use client";

import { useState } from "react";

type Team = { id: string; name: string };
type Part = { id: string; name: string; teamId: string };

// 역할·팀·파트 드롭다운. 파트는 선택한 팀의 것만 보이고, 팀을 바꾸면 파트 선택이 초기화된다.
// 파트는 PM·파트장 역할에만 저장되므로 다른 역할이면 파트 선택을 막고 이유를 보여 준다.
// (서버 applyApproval이 같은 규칙과 "파트가 선택한 팀 소속인지"를 다시 검증한다.)
export function TeamPartFields({
  teams, parts, defaultRole, defaultTeamId, defaultPartId,
}: {
  teams: Team[]; parts: Part[]; defaultRole: string; defaultTeamId: string; defaultPartId: string;
}) {
  const [role, setRole] = useState(defaultRole);
  const [teamId, setTeamId] = useState(defaultTeamId);
  const [partId, setPartId] = useState(defaultPartId);
  const teamParts = parts.filter((p) => p.teamId === teamId);
  const usesPart = role === "PM" || role === "PART_LEADER";
  const selectClass = "border border-[var(--color-border)] rounded px-1";

  return (
    <>
      <select
        name="role"
        value={role}
        onChange={(e) => {
          setRole(e.target.value);
          if (e.target.value !== "PM" && e.target.value !== "PART_LEADER") setPartId("");
        }}
        className={selectClass}
      >
        <option value="SUPER_ADMIN">최고관리자</option>
        <option value="ADMIN">팀 관리자</option>
        <option value="PART_LEADER">파트장</option>
        <option value="SETTLEMENT">정산담당자</option>
        <option value="PM">PM</option>
      </select>
      {/* 팀은 팀 관리자·PM·파트장에게 의미가 있다(최고관리자·정산담당자는 전체 접근이라 무시됨). */}
      <select
        name="teamId"
        value={teamId}
        onChange={(e) => { setTeamId(e.target.value); setPartId(""); }}
        className={selectClass}
      >
        <option value="">팀 없음</option>
        {teams.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {/* 파트: PM·파트장만 저장된다. 파트장은 그 파트의 파트장이 되고(파트당 1명), PM은 그 파트장 소속이 된다. */}
      <select
        name="partId"
        value={partId}
        onChange={(e) => setPartId(e.target.value)}
        disabled={!usesPart || !teamId}
        title={usesPart ? (teamId ? undefined : "팀을 먼저 선택하세요") : "파트는 PM·파트장만 지정할 수 있습니다"}
        className={selectClass}
      >
        <option value="">{!usesPart ? "파트: PM·파트장만" : !teamId ? "팀 먼저 선택" : "파트 없음"}</option>
        {teamParts.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </>
  );
}
