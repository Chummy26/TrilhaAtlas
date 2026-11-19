import { ProfileView } from "@/components/study/profile-view";
import { studyProfile } from "@/src/server";

// Dynamic: every visit re-reads the learner logs and chat usage.
export const dynamic = "force-dynamic";

export default function ProfilePage() {
	return (
		<div className="h-dvh overflow-y-auto">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<ProfileView profile={studyProfile()} />
		</div>
	);
}
