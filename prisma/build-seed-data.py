# 5파트_고객사정리.xlsx → prisma/seed-data.json 생성기.
# 실행: `python prisma/build-seed-data.py`  (프로젝트 루트 또는 어디서든)
# 신규 npm 의존성 없이 표준 라이브러리(zipfile + xml)만 사용한다.
# Sheet1 'PM별(26)'의 27개 고객사를 기준으로, 과업/월별 실적은 Sheet2 '26 월별 실적'에서
# 이름 매칭해 결합한다. 자세한 규칙은 계획 파일 참조.
import zipfile, re, json, os
from datetime import date, timedelta
import xml.etree.ElementTree as ET

# 엑셀 위치: 리포 밖(C:\dev)에 있음. 이 스크립트(prisma/) 기준 상위 두 단계.
HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, "..", "..", "5파트_고객사정리.xlsx")
OUT = os.path.join(HERE, "seed-data.json")

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
MONTHS = list("JKLMNOPQRSTU")  # J=1월 … U=12월 (I열=25년 집행금액은 제외)
SUBTOTAL = ("총 계 (부가세 미포함)", "부가세", "총 계 (부가세 포함)")

# 고객사 목록/담당PM은 Sheet1을 그대로 따른다(행이 추가·삭제돼도 자동 반영).
# 아래는 Sheet1 표기와 Sheet2 블록명이 다른 예외만 매핑한다. 없으면 동일 이름으로 매칭.
# "라인 계열(7개)"만 Sheet2의 7개 블록을 하나로 통합한다.
NAME_MAP = {
    "인천시노사민정": ["인천시 노사민정\n(마음 사이다)"],
    "한국산업기술진흥원": ["한국산업기술진흥원\n(KIAT)"],
    "국민건강보험공단": ["국민건강보험공단(26)"],
    "한국사회복지협의회(두산소방가족)": ["한국사회복지협의회\n(두산소방가족)"],
    "라인 계열(7개)": ["라인플러스", "라인파이낸셜", "라인페이플러스", "라인스튜디오",
                    "라인넥스트", "IPX", "라인프렌즈스퀘어"],
}


def load(z):
    ss = []
    for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si"):
        ss.append("".join(t.text or "" for t in si.iter(NS + "t")))

    def rows(sheet):
        out = []
        for row in ET.fromstring(z.read(sheet)).iter(NS + "row"):
            d = {}
            for c in row.findall(NS + "c"):
                v = c.find(NS + "v")
                if v is None:
                    continue
                col = re.match("[A-Z]+", c.get("r")).group()
                d[col] = ss[int(v.text)] if c.get("t") == "s" else v.text
            out.append(d)
        return out

    return rows


def serial_to_iso(val):
    """Excel 시리얼 날짜 → ISO 문자열(YYYY-MM-DD). 비어있으면 None."""
    if val is None:
        return None
    try:
        n = int(float(val))
        if n < 1:
            return None
        return (date(1899, 12, 30) + timedelta(days=n)).isoformat()
    except (ValueError, OverflowError):
        return None


def split_cycle(val):
    """'월, 분기, 최종' → ['월', '분기', '최종']. 빈 값이면 []."""
    if not val:
        return []
    return [s.strip() for s in val.split(",") if s.strip()]


def num(v):
    if v in (None, "", "None"):
        return None
    try:
        return float(v)
    except ValueError:
        return None  # "실적 계약", "#DIV/0!" 등


def build():
    z = zipfile.ZipFile(XLSX)
    rows = load(z)

    # Sheet1: 고객사 목록(순서대로) + 담당PM + 계약정보. 헤더 제외, B열 있는 행만.
    s1 = rows("xl/worksheets/sheet1.xml")
    sheet1_clients = []  # [dict]
    for r in s1[1:]:
        name = r.get("B")
        if name and name != "고객사명":
            sheet1_clients.append({
                "name": name,
                "pm": r.get("A"),
                "businessType": r.get("C"),
                "contractStart": serial_to_iso(r.get("E")),
                "contractEnd": serial_to_iso(r.get("F")),
                "billingCycle": split_cycle(r.get("G")),
                "reportCycle": split_cycle(r.get("H")),
            })

    # Sheet2: 블록별 과업 파싱
    s2 = rows("xl/worksheets/sheet2.xml")
    blocks = {}
    cur = None
    for r in s2:
        if r.get("A") and r.get("B") and re.match(r"^\d+$", str(r["A"])):
            cur = r["B"]
            blocks.setdefault(cur, [])
        c = r.get("C")
        if not c or c in SUBTOTAL or c.startswith("총") or cur is None:
            continue
        d = num(r.get("D"))
        e = num(r.get("E"))
        f = num(r.get("F"))
        unit_price = round(d) if d else 0
        perfs = []
        for i, m in enumerate(MONTHS, start=1):
            cnt = num(r.get(m))
            if not cnt:  # None 또는 0 → 실적 없음
                continue
            perfs.append({
                "month": i,
                "count": round(cnt),
                "amount": round(cnt * d) if d else 0,
            })
        blocks[cur].append({
            "name": c,
            "unitPrice": unit_price,
            "contractCount": round(e) if e else None,
            "contractAmount": round(f) if f else None,
            "performances": perfs,
        })

    # Sheet1 고객사 순서대로 Sheet2 블록 결합
    clients = []
    for d in sheet1_clients:
        cname = d["name"]
        srcs = NAME_MAP.get(cname, [cname])
        tasks = []
        for s in srcs:
            if s not in blocks:
                raise SystemExit(f"Sheet2 블록 없음: {s!r} (고객사 {cname!r})")
            tasks += blocks[s]
        clients.append({
            "name": cname,
            "pm": d["pm"],
            "businessType": d["businessType"],
            "contractStart": d["contractStart"],
            "contractEnd": d["contractEnd"],
            "billingCycle": d["billingCycle"],
            "reportCycle": d["reportCycle"],
            "tasks": tasks,
        })

    with open(OUT, "w", encoding="utf-8") as fp:
        json.dump(clients, fp, ensure_ascii=False, indent=2)

    n_tasks = sum(len(c["tasks"]) for c in clients)
    n_perf = sum(len(t["performances"]) for c in clients for t in c["tasks"])
    pms = sorted(set(c["pm"] for c in clients if c["pm"]))
    print(f"생성 완료: {OUT}")
    print(f"  고객사 {len(clients)}개, 과업 {n_tasks}개, 실적행 {n_perf}개")
    print(f"  담당PM: {pms}")


if __name__ == "__main__":
    build()
