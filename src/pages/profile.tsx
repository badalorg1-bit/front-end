import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CalendarDays, MapPin, Star, User } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { RatingStars } from "@/components/rating-stars";
import { EmptyState, LoadingSkeleton } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getReviewsForUser, getUserPublicProfile } from "@/lib/api";
import { fmtShortDate } from "@/lib/format";
import type { Review, UserPublicProfile } from "@/lib/types";

export function PublicProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [p, r] = await Promise.all([getUserPublicProfile(id), getReviewsForUser(id)]);
      setProfile(p);
      setReviews(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تحميل الملف.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingSkeleton />;
  if (error)
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  if (!profile)
    return (
      <EmptyState
        icon={User}
        title="لا يوجد ملف لهذا المستخدم"
        description="ربما تم حذف الحساب أو حظره."
      />
    );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="rounded-2xl border border-line bg-card p-6 shadow-l1">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar src={profile.avatar_url} name={profile.display_name} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-ink">{profile.display_name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              {profile.city && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" />
                  {profile.city}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" />
                عضو منذ {fmtShortDate(profile.created_at)}
              </span>
            </div>
            <div className="mt-2">
              {profile.rating_count > 0 ? (
                <span className="inline-flex items-center gap-2">
                  <RatingStars value={profile.rating_avg} count={profile.rating_count} />
                  <span className="text-sm font-semibold text-ink tabular-nums">
                    {profile.rating_avg.toFixed(1)}
                  </span>
                </span>
              ) : (
                <span className="text-sm text-ink-muted">لا توجد تقييمات بعد</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <h2 className="mt-8 flex items-center gap-2 text-lg font-bold text-ink">
        <Star className="size-5 text-gold-deep" />
        التقييمات ({reviews.length})
      </h2>

      {reviews.length === 0 ? (
        <EmptyState
          icon={Star}
          title="لا توجد تقييمات"
          description="ستظهر التقييمات هنا بعد اكتمال صفقات ناجحة."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-card p-4 shadow-l1">
              <div className="flex items-start gap-3">
                <Avatar src={r.reviewer_avatar} name={r.reviewer_name ?? "مستخدم"} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      to={`/u/${r.reviewer_id}`}
                      className="font-semibold text-ink hover:text-brand-deep hover:underline"
                    >
                      {r.reviewer_name ?? "مستخدم"}
                    </Link>
                    <span className="text-xs text-ink-muted">{fmtShortDate(r.created_at)}</span>
                  </div>
                  <div className="mt-1">
                    <RatingStars value={r.rating} size="sm" />
                  </div>
                  {r.comment && (
                    <p className="mt-2 text-sm leading-6 text-ink-muted">{r.comment}</p>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
