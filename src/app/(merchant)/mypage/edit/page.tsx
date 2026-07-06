import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { ProfileForm } from "@/components/ProfileForm";

export default async function EditProfilePage() {
  const user = await requireMerchant();
  return (
    <>
      <Topbar backHref="/mypage" title="프로필 수정" />
      <div className="page">
        <h1 className="h1">프로필 수정</h1>
        <p className="lead">개인정보를 수정할 수 있어요.</p>
        <ProfileForm
          storeName={user.storeName}
          phone={user.phone}
          address={user.address}
        />
      </div>
    </>
  );
}
