# ENCRYPTION_KEY backup

오픈벨 계정 알림의 봇 토큰·메일 비밀번호는 `ENCRYPTION_KEY`로 AES-GCM 암호화한다.
키가 없으면 `BETTER_AUTH_SECRET`에서 파생한다. 키를 잃으면 저장된 비밀은 복구하지 못한다.

이 폴더에 키 파일을 두되 커밋하지 않는다. `*.key`, `*.txt`, `*.env`는 gitignore다.
베셀 환경변수 `ENCRYPTION_KEY`와 같은 값을 여기에도 복사해 둔다. 로테이션 주기는 아직 없다.
