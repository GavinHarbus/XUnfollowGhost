/**
 * Snapshot diff engine using two-pointer merge on sorted arrays.
 */

export function diffSnapshots(previousSnapshot, currentSnapshot) {
  const prev = previousSnapshot.followerIds;
  const curr = currentSnapshot.followerIds;

  const unfollowedIds = [];
  const newFollowerIds = [];
  let unchangedCount = 0;
  let i = 0;
  let j = 0;

  while (i < prev.length && j < curr.length) {
    if (prev[i] === curr[j]) {
      unchangedCount++;
      i++;
      j++;
    } else if (prev[i] < curr[j]) {
      unfollowedIds.push(prev[i]);
      i++;
    } else {
      newFollowerIds.push(curr[j]);
      j++;
    }
  }

  while (i < prev.length) {
    unfollowedIds.push(prev[i]);
    i++;
  }

  while (j < curr.length) {
    newFollowerIds.push(curr[j]);
    j++;
  }

  return { unfollowedIds, newFollowerIds, unchangedCount };
}

export function computeSnapshotFromFollowers(userId, followers) {
  return {
    timestamp: Date.now(),
    userId,
    followerCount: followers.length,
    followerIds: followers.map((f) => f.userId).sort(),
  };
}
