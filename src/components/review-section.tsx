import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Loader2, Send, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Avatar } from "@/components/avatar";
import { RatingStars } from "@/components/rating-stars";
import { createReview, getReviewsForUser, getUserPublicProfile, hasReviewedRequest } from "@/lib/api";
import { useAuth } from "@/store/auth";
import type { RequestWithListing, Review, UserPublicProfile } from "@/lib/types";

interface Props {
  request: RequestWithListing;
  revieweeId: string;
  onChanged?: () => void;
}

export function ReviewSection({ request, revieweeId, onChanged }: Props) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserPublicProfile | null>(null);
  const [existing, setExisting] = useState<Review | null>(null);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const isSelf = user?.id === revieweeId;

  const load = useCallback(async () => {
    try {
      const [p, reviews] = await Promise.all([
        getUserPublicProfile(revieweeId),
        getReviewsForUser(revieweeId),
      ]);
      setProfile(p);
      const mine = await hasReviewedRequest(request.id);
      setAlreadyReviewed(mine);
      if (mine && user) {
        const mineReview = reviews.find((r) => r.reviewer_id === user.id && r.request_id === request.id);
        setExisting(mineReview ?? null);
      }
    } catch {
      /* non-critical */
    }
  }, [revieweeId, request.id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      setError("اختر عدد النجوم أولاً.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createReview({
        request_id: request.id,
        reviewee_id: revieweeId,
        rating,
        comment: comment.trim(),
      });
      setFlash("تم إرسال التقييم بنجاح.");
      setAlreadyReviewed(true);
      setComment("");
      setRating(0);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر إرسال التقييم.");
    } finally {
      setBusy(false);
    }
  };

  if (isSelf || request.status !== "accepted") return null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-secondary/40 p-3.5">
      <p className="mb-2 text-sm font-semibold text-ink">قيّم هذا الطرف</p>

      {profile && (
        <Link
          to={`/u/${profile.id}`}
          className="mb-3 inline-flex items-center gap-2 text-sm text-ink-muted hover:text-brand-deep hover:underline"
        >
          <Avatar src={profile.avatar_url} name={profile.display_name} size="sm" />
          <span>{profile.display_name}</span>
          {profile.rating_count > 0 && (
            <RatingStars value={profile.rating_avg} count={profile.rating_count} size="sm" />
          )}
        </Link>
      )}

      {alreadyReviewed ? (
        <div className="rounded-md border border-success-line bg-success-soft p-2.5 text-xs text-success-ink">
          {existing ? (
            <>
              <p className="mb-1 font-medium">تقييمك الحالي:</p>
              <RatingStars value={existing.rating} size="sm" />
              {existing.comment && <p className="mt-1 text-ink-muted">{existing.comment}</p>}
            </>
          ) : (
            "لقد قيّمت هذا الطلب بالفعل."
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <Label>التقييم</Label>
            <div className="mt-1 flex gap-0.5" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  className="p-0.5"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setRating(i)}
                  aria-label={`${i} نجوم`}
                >
                  <Star
                    className={`size-6 ${
                      i <= (hover || rating)
                        ? "fill-gold-deep text-gold-deep"
                        : "text-ink-muted/40"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor={`review-comment-${request.id}`}>تعليق (اختياري)</Label>
            <Textarea
              id={`review-comment-${request.id}`}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="كيف كانت التجربة؟"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          {flash && <p className="text-xs text-success-ink">{flash}</p>}
          <Button type="submit" size="sm" disabled={busy || rating < 1}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            إرسال التقييم
          </Button>
        </form>
      )}
    </div>
  );
}
