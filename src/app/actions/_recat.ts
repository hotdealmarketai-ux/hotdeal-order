"use server";

// ⚠ 임시(1회성) — 현재고 245개를 새 카테고리(majorCat/minorCat)로 재분류 적용. id 기준 매칭.
// 관리자가 재고현황 작성 상단 버튼으로 실행. 미리보기(commit=false)로 확인 후 적용(commit=true).
// 적용·검증 후 이 파일과 버튼, 페이지 사용처를 제거한다. 수량·미수·발주와 무관, 카테고리 표시만 변경.
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";

// id → { name(참고용), major, minor }
const MAP: Record<string, { name: string; major: string; minor: string }> = {
  "cms42q8z2000ek004gar22t7j": {
    "name": "고소한 쌀과자",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cmu0xzoy00000gm0ac03jymjb": {
    "name": "오리온 마이구미 포도맛",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cmu0xzz9b0000gm0a4y6w39mb": {
    "name": "오리온 왕꿈틀이",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cmt2is9b20018jr04q9oxo8p1": {
    "name": "레몬맛 샌드 227g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q8z6000gk004513syj00": {
    "name": "베이비강냉이",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cms42q8yt000ak00401i9hm2j": {
    "name": "달달맛밤",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cms42q8yo0008k00463yiszpr": {
    "name": "씬크래커 치즈맛",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cmuc0wawn0003gm0a6jgolu2l": {
    "name": "미니 프레첼 매콤한비프맛 75g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cmtmpun0f0000gm0aginjejm0": {
    "name": "와그작 더 좋아해 동결건조 북어",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmtmpv54d0002gm09mvgsa0qf": {
    "name": "와그작 더 좋아해 동결건조 오리가슴살",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmtmpux6e0002gm0aqqn1cbnl": {
    "name": "와그작 더 좋아해 동결건조 닭가슴살",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmuc0wax40004gm0a2cdz73om": {
    "name": "클래식 찰옥수수",
    "major": "옥수수",
    "minor": ""
  },
  "cmuc0wax70005gm0amw6k5114": {
    "name": "블랙 미숫가루 500g",
    "major": "견과·건강식품",
    "minor": "미숫가루·곡물가루"
  },
  "cmu0lxv530000gm0ayukcqh9d": {
    "name": "봉쉐프 홍게해물맛 코인육수",
    "major": "양념·소스·기름",
    "minor": "소스·양념"
  },
  "cmu0ly34j0002gm0aq9ivlht8": {
    "name": "봉쉐프 사골맛 코인육수",
    "major": "양념·소스·기름",
    "minor": "소스·양념"
  },
  "cmu0lyd020004gm0abtl13xh3": {
    "name": "봉쉐프 멸치맛 코인육수",
    "major": "양념·소스·기름",
    "minor": "소스·양념"
  },
  "cms42q9be005nk0047bzaasd6": {
    "name": "나대진미 복어포",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cms42q928001tk004xx6h22kz": {
    "name": "코코넛건빵",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q9b3005ik0041ckvn99r": {
    "name": "트루나스 망고과일칩",
    "major": "과자·스낵",
    "minor": "과일칩"
  },
  "cms42q9b5005jk004kf721j5z": {
    "name": "트루나스 블루베리과일칩",
    "major": "과자·스낵",
    "minor": "과일칩"
  },
  "cms42q8z8000hk0043kszo57d": {
    "name": "묵끄럽 곤약스낵 오리지널 마라향",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cmtavq6qg0006jy0489ucq6t4": {
    "name": "제일한과 약과",
    "major": "베이커리·떡·디저트",
    "minor": "떡·한과"
  },
  "cms42q8ye0004k004mxryq0v8": {
    "name": "강냉이요",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cmu0y8hr30002gm0bu99olju8": {
    "name": "스몰 오트 초코 300g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q90b000zk004blayfri6": {
    "name": "그시절김",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cms42q8zf000kk004mvcv1mr4": {
    "name": "조참깨 곡물과자",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cmu0xfsey0000gm0ae8wmgozd": {
    "name": "해밀 찹쌀 누룽지 달콤한 맛 288g",
    "major": "과자·스낵",
    "minor": "누룽지·부각"
  },
  "cmuc0wayi0006gm0adxdof9ln": {
    "name": "고구마맛집",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cms42q900000uk00433kkmb5g": {
    "name": "스위씨 나쵸칩",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cms42q8yc0003k0049bqo5te6": {
    "name": "우리밀 마카로니",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cmsful9hr0000l404ow64a5rr": {
    "name": "맛뻥",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cms42q8y00000k0044se0zqa9": {
    "name": "꽃새우 쌀과자",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cms42q8yv000bk004n4u3fnww": {
    "name": "블랙 트러플 하몽 크래커 319g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q8yx000ck004f1qzkenv": {
    "name": "블랙 트러플 하몽 크래커 272g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cmu0ya5jy0004if04h2i4cmyq": {
    "name": "오리온 오징어땅콩 98g",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cms42q8zl000nk004ffgt54iz": {
    "name": "치즈샌드쿠키",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cmu0ybrqm0004gm0b7qyu9mbs": {
    "name": "티니핑 딸기소금우유 팝콘 40g",
    "major": "과자·스낵",
    "minor": "팝콘·기타"
  },
  "cmt0ujibv0004jr04pi9ekfpm": {
    "name": "애플사이다비니거 30포",
    "major": "견과·건강식품",
    "minor": "건강기능식품"
  },
  "cmu0lwt2k0004l804not1pq9k": {
    "name": "티젠 콤부차 레몬 30스틱",
    "major": "차·티",
    "minor": "티·티백"
  },
  "cmu3tnbpi0002gm092mgqphzc": {
    "name": "소금우유 랑드샤",
    "major": "베이커리·떡·디저트",
    "minor": "구움과자"
  },
  "cms42q9bb005mk004gf94zgn9": {
    "name": "동결건조 간편대파",
    "major": "견과·건강식품",
    "minor": "건조채소·버섯"
  },
  "cms42q9b7005kk004ocda1com": {
    "name": "동결건조 고추한알",
    "major": "견과·건강식품",
    "minor": "건조채소·버섯"
  },
  "cms42q9b9005lk004zfprwvyy": {
    "name": "동결건조 마늘한알",
    "major": "견과·건강식품",
    "minor": "건조채소·버섯"
  },
  "cms42q9bm005rk004gdz1470c": {
    "name": "1일 1레몬 유기농 레몬즙",
    "major": "차·티",
    "minor": "청·과일청"
  },
  "cmtxrobe10000gm0a36rlzufk": {
    "name": "곤약 쫀드기",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cmtxror2h0004gm0a46p8hlf5": {
    "name": "석류 쫀드기",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cmtxroj7u0002gm0a9ouu4ruw": {
    "name": "감귤 쫀드기",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cms42q90x0018k0043cx2lpyv": {
    "name": "네이처스 루피니빈",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cms42q92a001uk004sr82icqa": {
    "name": "믹스넛트 500g",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cms42q92t0022k0049htt85s8": {
    "name": "매일견과",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cmtaupjqu0000l104kq576otw": {
    "name": "쌍계명차 사과 히비스커스티",
    "major": "차·티",
    "minor": "티·티백"
  },
  "cmtaupw4u0000l10478gwhg5y": {
    "name": "쌍계명차 레몬 캐모마일티",
    "major": "차·티",
    "minor": "티·티백"
  },
  "cmtauq84t0000ji04hbirnsac": {
    "name": "쌍계명차 오렌지 루이보스",
    "major": "차·티",
    "minor": "티·티백"
  },
  "cmu12bcrw0000ld04d5ua3xh9": {
    "name": "꽃샘 아샷추 복숭아20T",
    "major": "차·티",
    "minor": "티·티백"
  },
  "cmtvbtrg10000l604vuxcnj18": {
    "name": "안단잼 블루베리 380g",
    "major": "양념·소스·기름",
    "minor": "잼"
  },
  "cmtibwth80000hu0aqublbglg": {
    "name": "명품 참기름 350ml",
    "major": "양념·소스·기름",
    "minor": "기름"
  },
  "cmtdulbks0002ib046vcefjrz": {
    "name": "명품 들기름 350ml",
    "major": "양념·소스·기름",
    "minor": "기름"
  },
  "cmuc0wb100007gm0azigl2pld": {
    "name": "달랏 마카다미아",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cmsu14isn0003jm04q3c1q1gw": {
    "name": "키하이로 성장패치",
    "major": "뷰티·헬스케어",
    "minor": "건강·미용패치"
  },
  "cms7ce3n60000l104s9ln0aio": {
    "name": "썸머패치",
    "major": "뷰티·헬스케어",
    "minor": "건강·미용패치"
  },
  "cmuc0wb190008gm0aryfzitec": {
    "name": "비치백 민트",
    "major": "생활잡화",
    "minor": "계절·기타"
  },
  "cmt9h2gbd0004l5043oxvq1gx": {
    "name": "아이컷 저당밥솥",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cms42q911001ak0049kc2vrzj": {
    "name": "라면국자 퍼플",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q913001bk004yzr2fw6w": {
    "name": "라면국자 옐로우",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q915001ck004qidwm8vq": {
    "name": "라면국자 블루",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q917001dk004q7nox0fv": {
    "name": "젓가락 퍼플",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q919001ek004z51gtt7x": {
    "name": "젓가락 옐로우",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q91b001fk004m8438001": {
    "name": "젓가락 블루",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q91d001gk0043k81dx0g": {
    "name": "스쿱 퍼플",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q91f001hk004kgkzwea7": {
    "name": "스쿱 옐로우",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q91i001ik004nj3cq9p6": {
    "name": "스쿱 블루",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q90s0016k004ft3n93ac": {
    "name": "수박커팅기 민트",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cms42q90u0017k004ud708ilj": {
    "name": "수박커팅기 아이보리",
    "major": "주방용품",
    "minor": "조리도구"
  },
  "cmt17amk10000l40438jxzn2c": {
    "name": "데일리 광수세미 8P",
    "major": "주방용품",
    "minor": "세척"
  },
  "cmsdx5dcz000ojv04bqk5va2w": {
    "name": "올비아 플레이트팬 실리콘 손잡이",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cmsdx4ski000hkz04ktep3nzw": {
    "name": "올비아 플레이트팬 탈착 손잡이",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cmuc0wb2n0009gm0a4hf32bye": {
    "name": "PE봉투 (소) 100장",
    "major": "포장·부자재",
    "minor": "봉투"
  },
  "cmuc0wb2q000agm0av2l1y89w": {
    "name": "PE봉투 (중) 100장",
    "major": "포장·부자재",
    "minor": "봉투"
  },
  "cmuc0wb2t000bgm0a7pxizomf": {
    "name": "PE봉투 (대) 100장",
    "major": "포장·부자재",
    "minor": "봉투"
  },
  "cmuc0wb2w000cgm0atb9yg02q": {
    "name": "핫딜마켓 봉투 (소) 100장",
    "major": "포장·부자재",
    "minor": "봉투"
  },
  "cmuc0wb2z000dgm0acpkpkhua": {
    "name": "핫딜마켓 봉투 (대) 100장",
    "major": "포장·부자재",
    "minor": "봉투"
  },
  "cms4fomy3000ki804qghb13wg": {
    "name": "미니LED선풍기",
    "major": "생활가전",
    "minor": "선풍기·계절가전"
  },
  "cms87wju20000jv04j6lx5p2j": {
    "name": "디오닉 비앙카 BLDC 8인치 무선 선풍기",
    "major": "생활가전",
    "minor": "선풍기·계절가전"
  },
  "cmuc0wb38000egm0ab6y1s1rg": {
    "name": "욕실화 세트 화이트/그레이 2종",
    "major": "생활잡화",
    "minor": "욕실·생활"
  },
  "cmuc0wb3a000fgm0ao6z93ppw": {
    "name": "욕실화 세트 그린/차콜 2종",
    "major": "생활잡화",
    "minor": "욕실·생활"
  },
  "cmtduvv630002l8048txqg7z4": {
    "name": "비타씨 토닝케어 크림 모이스처라이저",
    "major": "뷰티·헬스케어",
    "minor": "화장품"
  },
  "cmtduwq9w0000lb04ol2yv2ck": {
    "name": "디오프러스 매직 비비크림 21호",
    "major": "뷰티·헬스케어",
    "minor": "화장품"
  },
  "cmtduxaer000jl704wkp763fv": {
    "name": "디오프러스 비타씨 토닝케어 앰플 세럼",
    "major": "뷰티·헬스케어",
    "minor": "화장품"
  },
  "cmuc0wb3n000ggm0akvdij4rs": {
    "name": "금색 보자기(중) 10장",
    "major": "포장·부자재",
    "minor": "보자기·기타"
  },
  "cmuc0wb3q000hgm0aste8b5ik": {
    "name": "금색 보자기(대) 10장",
    "major": "포장·부자재",
    "minor": "보자기·기타"
  },
  "cmsdvxihw0000ju04qktlczdc": {
    "name": "커팅용기 50p",
    "major": "포장·부자재",
    "minor": "용기"
  },
  "cmuc0wb3w000igm0apiog5hs7": {
    "name": "왕오징어 구이",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cms42q92o0020k004n69lfnhz": {
    "name": "쏙빠지는 프로바이오틱스",
    "major": "견과·건강식품",
    "minor": "건강기능식품"
  },
  "cms42q92r0021k00428ubccel": {
    "name": "홍삼정 데일리스틱",
    "major": "견과·건강식품",
    "minor": "건강기능식품"
  },
  "cmuc0wb45000jgm0agqw8ucaf": {
    "name": "즉석 절단 돌김/곱창김 40g",
    "major": "수산·해산물",
    "minor": "김·해조"
  },
  "cms760uz50002jo04qxnfqa3x": {
    "name": "차칸오다리 동전 쥐포",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cmu3tebfk000dgm0abt5e0cif": {
    "name": "제주소금 선물세트",
    "major": "선물세트",
    "minor": "혼합세트"
  },
  "cmuc0wb4e000kgm0ahu039fqn": {
    "name": "민하네 김부각 6개세트",
    "major": "선물세트",
    "minor": "혼합세트"
  },
  "cmuc0wb4g000lgm0afc8rbncw": {
    "name": "핫팩",
    "major": "생활잡화",
    "minor": "계절·기타"
  },
  "cms42q8zj000mk004pmigmmxw": {
    "name": "스위코 망고푸딩",
    "major": "과자·스낵",
    "minor": "젤리·당류"
  },
  "cms42q8ym0007k00449m0vzbf": {
    "name": "옛날 찹쌀 꿀꽈배기",
    "major": "베이커리·떡·디저트",
    "minor": "도넛·모찌"
  },
  "cms42q8y90002k0044e4qazf5": {
    "name": "12곡 한입 쏙 보리과자",
    "major": "과자·스낵",
    "minor": "쌀·곡물과자"
  },
  "cmuc0wb4s000mgm0awdjsowxn": {
    "name": "에스파뇰라 유기농 올리브유 500ml",
    "major": "양념·소스·기름",
    "minor": "기름"
  },
  "cms42q92j001yk004lhge2ood": {
    "name": "맥반석 오징어",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cmtigbbr20002km0anv2m4c1b": {
    "name": "와그작 하루간식 과일이랑 야채",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmtigboez0004km0a2pa639xq": {
    "name": "와그작 하루간식 닭고기랑 과일야채",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmtigbx7s0000kz04cli134aq": {
    "name": "와그작 하루간식 오리랑 과일야채",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmtigccxc0000k1042sc1hfa6": {
    "name": "와그작 하루간식 소고기랑 과일야채",
    "major": "반려동물",
    "minor": "간식"
  },
  "cmu3tqeaz0000gm0akacl205t": {
    "name": "살사리토 나초칩 454g",
    "major": "과자·스낵",
    "minor": "스낵·나쵸"
  },
  "cmtdukxod0000ib04frkbmkr0": {
    "name": "찹쌀가득 믹스 부각 200g",
    "major": "과자·스낵",
    "minor": "누룽지·부각"
  },
  "cmtduog6n000dib04fifwlry1": {
    "name": "바사삭 국산 누룽지튀김 130g",
    "major": "과자·스낵",
    "minor": "누룽지·부각"
  },
  "cmtdup8b7000bl704dzvngspd": {
    "name": "가마솥 손 누룽지 250g",
    "major": "과자·스낵",
    "minor": "누룽지·부각"
  },
  "cmtxrspv6000egm09r72s696m": {
    "name": "노르드멜 선물세트",
    "major": "선물세트",
    "minor": "혼합세트"
  },
  "cms42q8yg0005k00473bdb8vb": {
    "name": "우도땅콩샌드",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q8z0000dk004ini7oprt": {
    "name": "블랙 트러플 하몽소다 크래커 294g",
    "major": "과자·스낵",
    "minor": "크래커·쿠키"
  },
  "cms42q92f001wk004rcd7akar": {
    "name": "단짠단짠 오징어스틱",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cmuc0wb63000ngm0a3rye24wc": {
    "name": "어포와삭이",
    "major": "과자·스낵",
    "minor": "건어물·김스낵"
  },
  "cmu0m0i52000cgm0azjqfrpos": {
    "name": "올핏 올리브오일 30캡슐",
    "major": "견과·건강식품",
    "minor": "건강기능식품"
  },
  "cmu0ve7kx0000js04k6b4g7jv": {
    "name": "날아라 병아리콩 50g",
    "major": "견과·건강식품",
    "minor": "견과·콩"
  },
  "cms42q8zr000qk004ntdwsd0g": {
    "name": "스위트콘",
    "major": "통조림",
    "minor": ""
  },
  "cmu0lzvre000agm0a2w1879h2": {
    "name": "올핏 올리브 레몬샷",
    "major": "견과·건강식품",
    "minor": "건강기능식품"
  },
  "cmu12a76y000agm0ae2r01r0m": {
    "name": "꽃샘 꿀레몬 800g",
    "major": "차·티",
    "minor": "청·과일청"
  },
  "cmu12ak1x0000gm0adqf5jiej": {
    "name": "꽃샘 꿀생강 800g",
    "major": "차·티",
    "minor": "청·과일청"
  },
  "cms42q91o001lk00436fj45k4": {
    "name": "올비아 플레이팅팬 그린 높은팬",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cms42q91q001mk004oidaw908": {
    "name": "올비아 플레이팅팬 그린 낮은팬",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cms42q91s001nk0044k43kgeq": {
    "name": "올비아 플레이팅팬 그린 사각팬",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cms42q920001qk004ph40o153": {
    "name": "올비아 플레이팅팬 아이보리 낮은팬",
    "major": "주방용품",
    "minor": "팬·조리기구"
  },
  "cmu0vb80x0006gm0anbqyrl1f": {
    "name": "효담원 전통한과",
    "major": "베이커리·떡·디저트",
    "minor": "떡·한과"
  },
  "cmuc0wb76000ogm0aepaon2zy": {
    "name": "베지밀비 24개입",
    "major": "유제품",
    "minor": "두유·우유"
  },
  "cmtjsx5x60000kp0a9cgal3ps": {
    "name": "강화섬 쌀 10kg",
    "major": "쌀·잡곡",
    "minor": "쌀"
  },
  "cmtjd90tz0000jd09lnjp9hjk": {
    "name": "스타벅스 바닐라라떼 270ml",
    "major": "음료",
    "minor": "커피"
  },
  "cmtjd9hnq0002jd09gxsw6d3u": {
    "name": "스타벅스 모카라떼 270ml",
    "major": "음료",
    "minor": "커피"
  },
  "cmtl02r0n0001l00asbeon56b": {
    "name": "할리스 아메리카노 1L",
    "major": "음료",
    "minor": "커피"
  },
  "cms42q942002fk0040130xgy8": {
    "name": "에브리쿡 간장닭갈비",
    "major": "볶음·구이",
    "minor": "닭·닭갈비"
  },
  "cms42q9az005gk004tpelknbu": {
    "name": "한우물 대패삼겹볶음밥",
    "major": "면·밥",
    "minor": "주먹밥·볶음밥"
  },
  "cms42q948002hk004qkzbr7s7": {
    "name": "에브리쿡 간장불고기",
    "major": "볶음·구이",
    "minor": "소불고기"
  },
  "cms42q99f004rk004w4w4i0el": {
    "name": "반건조오징어",
    "major": "수산·해산물",
    "minor": "오징어·낙지·문어"
  },
  "cms42q955002tk004beleusao": {
    "name": "고기가득 소머리국밥",
    "major": "국·탕·찌개",
    "minor": "국밥·순대국"
  },
  "cms42q945002gk004lfj5agfj": {
    "name": "에브리쿡 고추장 돼지불고기",
    "major": "볶음·구이",
    "minor": "돼지불고기·불백"
  },
  "cmt0p7kdk0008l704m75cwvxh": {
    "name": "안동 한우 곱창 200g",
    "major": "볶음·구이",
    "minor": "곱창·막창·대창"
  },
  "cmt0p9ab10005l704r885k0fn": {
    "name": "안동 한우 막창 200g",
    "major": "볶음·구이",
    "minor": "곱창·막창·대창"
  },
  "cms42q9af0057k0043u1sb4hz": {
    "name": "노르웨이 순살고등어",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cms42q93o002bk004259m523n": {
    "name": "한우 소머리곰탕",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cmtv7xpgl0000gm0ayrq5b35l": {
    "name": "황기랑 당귀랑 닭곰탕 600g",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cmszuvj7m0003l104lx2fiy8u": {
    "name": "일월정 닭다리곰탕",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cms42q94a002ik004z9ispjmz": {
    "name": "핫이슈 직화고기짬뽕",
    "major": "국·탕·찌개",
    "minor": "짬뽕탕"
  },
  "cms42q940002ek004kw7lisiu": {
    "name": "돼지고기 김치찌개",
    "major": "국·탕·찌개",
    "minor": "찌개"
  },
  "cms42q99j004tk004o2sl29m8": {
    "name": "소막창",
    "major": "볶음·구이",
    "minor": "곱창·막창·대창"
  },
  "cmts9v9mg0000jy04rpicann7": {
    "name": "돈왕구이 1kg",
    "major": "볶음·구이",
    "minor": "돼지불고기·불백"
  },
  "cmtv7yycb0005gm0a4x9ba0br": {
    "name": "곤드레나물밥 460g",
    "major": "면·밥",
    "minor": "밥·덮밥"
  },
  "cmuc0wb90000pgm0akgv1qhgv": {
    "name": "별미집 생생수제비",
    "major": "국·탕·찌개",
    "minor": "수제비"
  },
  "cms42q9ao005bk0046610dmha": {
    "name": "바지락죽",
    "major": "국·탕·찌개",
    "minor": "죽"
  },
  "cmuc0wb95000qgm0a8mgji64p": {
    "name": "기영이네 숯불 닭강정 500g",
    "major": "볶음·구이",
    "minor": "닭강정·기타"
  },
  "cms42q957002uk004kd047cjj": {
    "name": "호주산 양갈비",
    "major": "정육·육류",
    "minor": "양·기타육"
  },
  "cms42q95g002yk004vepkfdp8": {
    "name": "무늬오징어",
    "major": "수산·해산물",
    "minor": "오징어·낙지·문어"
  },
  "cmtidkgc10008i50adgnhjzbk": {
    "name": "치즈헤븐 구워먹는치즈 300g",
    "major": "유제품",
    "minor": "치즈"
  },
  "cmticzgww0007i30aigd2uesj": {
    "name": "장단콩 청국장 200g",
    "major": "양념·소스·기름",
    "minor": "장·청국장"
  },
  "cmuc0wb9l000rgm0a4qiig6me": {
    "name": "수예당 감사 1호 선물세트",
    "major": "선물세트",
    "minor": "혼합세트"
  },
  "cmuc0wb9o000sgm0ah6ovvhx2": {
    "name": "수예당 꽃담 1호 선물세트",
    "major": "선물세트",
    "minor": "혼합세트"
  },
  "cms42q97j003wk004cmmdy25k": {
    "name": "수협인증 참 굴비",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cmu56qzn40002gm09qkff853p": {
    "name": "핑크 하트 마들렌",
    "major": "베이커리·떡·디저트",
    "minor": "구움과자"
  },
  "cmu56usyx0006gm0a5kvus202": {
    "name": "특 대 참돔",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cmtduc0t90006l704tn1tdxz5": {
    "name": "바르다김선생 김치치즈 주먹밥",
    "major": "면·밥",
    "minor": "주먹밥·볶음밥"
  },
  "cmtducflr0000gq04pfgk8pst": {
    "name": "바르다김선생 소불고기 주먹밥",
    "major": "면·밥",
    "minor": "주먹밥·볶음밥"
  },
  "cms42q95m0031k0040abosxxq": {
    "name": "반건조가자미 5팩 묶음",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cms42q99w004zk004asu6zpo8": {
    "name": "기름가자미 5미",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cms7g640l0002il04df82yrzu": {
    "name": "바른장인 간장깐새우장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cms773hmi000hjo044pael758": {
    "name": "바른장인 양념깐새우장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cms457w8l0000jg04tcnfts5e": {
    "name": "우거지청국장",
    "major": "양념·소스·기름",
    "minor": "장·청국장"
  },
  "cms42q95o0032k0044huva580": {
    "name": "통밀 피타브레드",
    "major": "베이커리·떡·디저트",
    "minor": "빵·베이글"
  },
  "cms42q969003bk004jlp7edrh": {
    "name": "통새우만두",
    "major": "만두·순대",
    "minor": "만두"
  },
  "cms42q99n004vk0048ofg8u9c": {
    "name": "전주수제초코파이 혼합",
    "major": "베이커리·떡·디저트",
    "minor": "구움과자"
  },
  "cms42q96d003dk004ruhm15wp": {
    "name": "플레인베이글",
    "major": "베이커리·떡·디저트",
    "minor": "빵·베이글"
  },
  "cmuc0wbau000tgm0aoz0yl6fx": {
    "name": "바른 한우곱창전골",
    "major": "전골·찜",
    "minor": "전골"
  },
  "cms42q9610038k0049xy816bz": {
    "name": "장단콩 비빔막국수",
    "major": "면·밥",
    "minor": "냉면·막국수"
  },
  "cms42q9640039k004551jnjhi": {
    "name": "장단콩 들기름 막국수",
    "major": "면·밥",
    "minor": "냉면·막국수"
  },
  "cmso4u30z0002jr04ed4fizm4": {
    "name": "직화알곱창",
    "major": "볶음·구이",
    "minor": "곱창·막창·대창"
  },
  "cmszuvti30008i804ym1uyyq9": {
    "name": "직화불닭발",
    "major": "볶음·구이",
    "minor": "오돌뼈·껍데기"
  },
  "cms42q98a0048k004qd8ln9yo": {
    "name": "치즈듬뿍콘치즈",
    "major": "김치·반찬",
    "minor": "밑반찬·무침"
  },
  "cms42q952002sk00437vibgqx": {
    "name": "남원추어탕",
    "major": "국·탕·찌개",
    "minor": "추어탕"
  },
  "cmuc0wbbc000ugm0aj3abxj82": {
    "name": "애슐리 버터와규 볶음밥 230g",
    "major": "면·밥",
    "minor": "주먹밥·볶음밥"
  },
  "cms42q9am005ak004w7tw94hc": {
    "name": "호호별미 얼큰순대국",
    "major": "국·탕·찌개",
    "minor": "국밥·순대국"
  },
  "cmsu159ya0000jv04xnk5527e": {
    "name": "함흥명가홍현 비빔냉면",
    "major": "면·밥",
    "minor": "냉면·막국수"
  },
  "cmuc0wbbl000vgm0almced78e": {
    "name": "세월낙지",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cmtlbrqkd0000hx0atya6ccwl": {
    "name": "바라던 듀록 삼겹살구이 500g",
    "major": "정육·육류",
    "minor": "돼지"
  },
  "cmuc0wbbq000wgm0anig9o1gc": {
    "name": "직화그릴떡갈비",
    "major": "볶음·구이",
    "minor": "동그랑땡·전"
  },
  "cms42q95i002zk004a0jm268j": {
    "name": "스타떡볶이",
    "major": "분식·떡볶이",
    "minor": "떡볶이"
  },
  "cmuc0wbbw000xgm0azzx8z2in": {
    "name": "대식가일키로부대찌개",
    "major": "국·탕·찌개",
    "minor": "감자탕·부대찌개"
  },
  "cmso4v38q0001l404kwgous2t": {
    "name": "대관령 낙곱새",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cmt9c3gya002jjl04qzspd78f": {
    "name": "느루식혜",
    "major": "음료",
    "minor": "식혜·전통음료"
  },
  "cmuc0wbc4000ygm0arpq80vc4": {
    "name": "단호박식혜",
    "major": "음료",
    "minor": "식혜·전통음료"
  },
  "cms42q92w0023k004cdrm1s20": {
    "name": "백년초 돼지왕구이",
    "major": "볶음·구이",
    "minor": "돼지불고기·불백"
  },
  "cmsy6u76a000vkz04ss8ff0wc": {
    "name": "사리원 소불고기 500g",
    "major": "볶음·구이",
    "minor": "소불고기"
  },
  "cmuc0wbcc000zgm0ayaa7js5q": {
    "name": "대식가 육개장 700g",
    "major": "국·탕·찌개",
    "minor": "육개장·닭개장"
  },
  "cms42q9300025k004fffufgi5": {
    "name": "봉봉쭈꾸미",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cms87v12m0000l504iq9bmjll": {
    "name": "이남장 설렁탕",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cms42q97f003uk004ggt1bz7y": {
    "name": "호호별미 양지곰탕",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cmtmgbmm40000gm09ido3zved": {
    "name": "백합술찜 440g",
    "major": "전골·찜",
    "minor": "찜·조림"
  },
  "cmu3tlvl50004jw04930b70b5": {
    "name": "바삭 치킨너겟 420g",
    "major": "볶음·구이",
    "minor": "닭강정·기타"
  },
  "cmu3tm5sg0000gm0asdqar829": {
    "name": "쫀득 쌀떡 산적 420g",
    "major": "볶음·구이",
    "minor": "동그랑땡·전"
  },
  "cmu3tmleo0000gm09l3y9u906": {
    "name": "동그랑땡 420g",
    "major": "볶음·구이",
    "minor": "동그랑땡·전"
  },
  "cms42q98n004ek0042jm3nv7l": {
    "name": "와우국물떡볶이",
    "major": "분식·떡볶이",
    "minor": "떡볶이"
  },
  "cms42q95x0036k004ar2vwmga": {
    "name": "팔덕 시래기등갈비찜",
    "major": "전골·찜",
    "minor": "찜·조림"
  },
  "cmtidomfu0000hu09mdrv9w8c": {
    "name": "새벽집 갈비탕 600g",
    "major": "국·탕·찌개",
    "minor": "곰탕·설렁탕·갈비탕"
  },
  "cms42q9820045k004e4zlqm7o": {
    "name": "간장새우장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cms42q9800044k004nwtf1kdd": {
    "name": "우정춘천닭갈비",
    "major": "볶음·구이",
    "minor": "닭·닭갈비"
  },
  "cmsu1516g0002lb04o5h20suc": {
    "name": "장가남도 양념게장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cmsu14s7j0005ky04hypf8543": {
    "name": "장가남도 간장게장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cms42q96b003ck004r70tiebp": {
    "name": "초계국수",
    "major": "면·밥",
    "minor": "국수"
  },
  "cms42q97a003sk004rh3xy1xn": {
    "name": "냉동멸치",
    "major": "수산·해산물",
    "minor": "생선"
  },
  "cmuc0wbdm0010gm0ar26yhvq1": {
    "name": "꼬막장 양념",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cmuc0wbdp0011gm0atgozxhiu": {
    "name": "꼬막장 간장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cmsodv99u0003jr04194ci1t5": {
    "name": "자숙문어장",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cms42q94h002kk004obl7f10c": {
    "name": "저세상 직화닭목살",
    "major": "볶음·구이",
    "minor": "닭·닭갈비"
  },
  "cms42q97y0043k004324jq3ym": {
    "name": "요리하는토끼 동치미열무국수",
    "major": "면·밥",
    "minor": "국수"
  },
  "cms42q99h004sk004idzv2cns": {
    "name": "부채살 큐브",
    "major": "정육·육류",
    "minor": "소"
  },
  "cms42q9aq005ck0047533vnkl": {
    "name": "한우 소고기야채죽",
    "major": "국·탕·찌개",
    "minor": "죽"
  },
  "cms42q95k0030k004uy9dpocp": {
    "name": "집밥공방 쭈꾸미볶음",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cms42q98t004hk004d77k0qvp": {
    "name": "순살족발 200g",
    "major": "정육·육류",
    "minor": "돼지"
  },
  "cmuc0wbeb0012gm0acnhoymk2": {
    "name": "어묵국물소스",
    "major": "양념·소스·기름",
    "minor": "소스·양념"
  },
  "cmtmg7oj00006gm0atwsq8jud": {
    "name": "앵커 버터 마늘빵",
    "major": "베이커리·떡·디저트",
    "minor": "빵·베이글"
  },
  "cmtuyzhgt0002gm0ar3ir1tas": {
    "name": "만두 쏙 소세지 청양",
    "major": "만두·순대",
    "minor": "소세지"
  },
  "cmtuyzt6w0004gm0aj3lw3rjt": {
    "name": "만두 쏙 소세지 오리지널",
    "major": "만두·순대",
    "minor": "소세지"
  },
  "cms42q9a50053k004tboy9mzc": {
    "name": "오리로스 300g",
    "major": "정육·육류",
    "minor": "닭·오리"
  },
  "cmsfmifnm0000li04oe08oqr1": {
    "name": "프리미엄 수제 소고기육전",
    "major": "볶음·구이",
    "minor": "동그랑땡·전"
  },
  "cmuc0wbes0013gm0acun1qbqs": {
    "name": "에브리쿡 불쭈꾸미",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cms42q99a004pk0042fpskatp": {
    "name": "전주 츠메타이 메밀소바",
    "major": "면·밥",
    "minor": "소바·메밀"
  },
  "cms4973nx0002l1048ze2y1xn": {
    "name": "히야츠루 흑미물냉면",
    "major": "면·밥",
    "minor": "냉면·막국수"
  },
  "cms42q950002rk004jaxa45nc": {
    "name": "오돌뼈 수제직화구이",
    "major": "볶음·구이",
    "minor": "오돌뼈·껍데기"
  },
  "cmuc0wbf40014gm0af0l7kz29": {
    "name": "매콤 직화무뼈닭발",
    "major": "볶음·구이",
    "minor": "오돌뼈·껍데기"
  },
  "cms42q96f003ek004z2fmdpf4": {
    "name": "흑돈 불고기 고추장맛",
    "major": "볶음·구이",
    "minor": "돼지불고기·불백"
  },
  "cms42q96y003mk004yh08gaj0": {
    "name": "동산김치만두",
    "major": "만두·순대",
    "minor": "만두"
  },
  "cms42q98r004gk004oie03zr7": {
    "name": "제주흑돼지고추장왕구이",
    "major": "볶음·구이",
    "minor": "돼지불고기·불백"
  },
  "cmtidis990006i50aerny86t6": {
    "name": "대식가 일키로 우거지감자탕",
    "major": "국·탕·찌개",
    "minor": "감자탕·부대찌개"
  },
  "cms42q967003ak004x2veb6hw": {
    "name": "해늘찹쌀순대",
    "major": "만두·순대",
    "minor": "순대"
  },
  "cms42q9a30052k004p2q6vq8f": {
    "name": "강릉댁 시래기코다리조림",
    "major": "전골·찜",
    "minor": "찜·조림"
  },
  "cms42q9as005dk0045gb2z3b1": {
    "name": "짜먹는명란",
    "major": "수산·해산물",
    "minor": "젓갈·장·게장"
  },
  "cmtmg633e0002gm0a2l8cjz6u": {
    "name": "해물믹스 500g",
    "major": "수산·해산물",
    "minor": "어묵·수산가공"
  },
  "cms42q95u0035k0047sqzqnjx": {
    "name": "얼큰한우국밥",
    "major": "국·탕·찌개",
    "minor": "국밥·순대국"
  },
  "cms42q96j003gk004ebkaf5ua": {
    "name": "오밀당 매콤오징어볶음",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cms42q96q003jk0040c7j0oq2": {
    "name": "오밀당 쭈꾸미삼겹살",
    "major": "볶음·구이",
    "minor": "쭈꾸미·낙지"
  },
  "cms42q96t003kk004gbfzab9c": {
    "name": "오밀당 소고기무국",
    "major": "국·탕·찌개",
    "minor": "무국"
  },
  "cmtvd0s1q0000ih04ov3vmx45": {
    "name": "한끼 어묵탕 220g",
    "major": "국·탕·찌개",
    "minor": "어묵탕"
  },
  "cms42q96v003lk004is6amsze": {
    "name": "영양모찌",
    "major": "베이커리·떡·디저트",
    "minor": "도넛·모찌"
  },
  "cms42q9860046k0044ovxbehl": {
    "name": "육대장 육개장",
    "major": "국·탕·찌개",
    "minor": "육개장·닭개장"
  }
};

export type RecatResult = {
  ok: boolean;
  commit: boolean;
  dbCount: number;
  mapCount: number;
  matched: number;
  willChange: number;
  applied: number;
  dbNotInMap: string[];
  mapNotInDb: string[];
  error?: string;
};

export async function runFullRecatAction(commit: boolean): Promise<RecatResult> {
  const admin = await requireAdmin();

  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, majorCat: true, minorCat: true },
  });

  const plan: { id: string; major: string; minor: string; changed: boolean }[] = [];
  const dbNotInMap: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const c = MAP[it.id];
    if (!c) { dbNotInMap.push(it.name); continue; }
    seen.add(it.id);
    const major = String(c.major ?? "").trim().slice(0, 40);
    const minor = String(c.minor ?? "").trim().slice(0, 40);
    plan.push({ id: it.id, major, minor, changed: it.majorCat !== major || it.minorCat !== minor });
  }
  const mapNotInDb = Object.keys(MAP).filter((id) => !seen.has(id)).map((id) => MAP[id].name);
  const willChange = plan.filter((p) => p.changed).length;

  let applied = 0;
  if (commit) {
    const toChange = plan.filter((p) => p.changed);
    try {
      await prisma.$transaction(
        async (tx) => {
          for (const p of toChange) {
            await tx.inventoryItem.update({
              where: { id: p.id },
              data: { majorCat: p.major, minorCat: p.minor },
            });
          }
        },
        { timeout: 120000, maxWait: 30000 },
      );
    } catch {
      return {
        ok: false, commit, dbCount: items.length, mapCount: Object.keys(MAP).length,
        matched: plan.length, willChange, applied: 0, dbNotInMap, mapNotInDb,
        error: "적용 중 오류가 발생했어요. 다시 시도해 주세요.",
      };
    }
    applied = toChange.length;
    await writeAudit({
      action: "inventory.recategorize",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "inventory",
      targetId: "*",
      summary: `현재고 재분류(245안) 적용: ${applied}개 변경(매칭 ${plan.length}/${items.length})`,
    });
    revalidatePath("/admin/inventory");
    revalidatePath("/inventory");
  }

  return {
    ok: true, commit, dbCount: items.length, mapCount: Object.keys(MAP).length,
    matched: plan.length, willChange, applied, dbNotInMap, mapNotInDb,
  };
}
