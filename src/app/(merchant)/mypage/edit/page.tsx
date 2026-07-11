import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { ProfileForm } from "@/components/ProfileForm";

export default async function EditProfilePage() {
  const user = await requireMerchant();
  return (
    <>
      <Topbar backHref="/mypage" title="프로필 수정" />
      <div className="page">
        <ProfileForm
          storeName={user.storeName}
          phone={user.phone}
          address={user.address}
        />
      </div>
    </>
  );
}
