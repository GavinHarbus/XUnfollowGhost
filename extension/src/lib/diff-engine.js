/**
 * Snapshot diff engine using two-pointer merge on sorted screenName arrays.
 */

export function diffSnapshots(previousSnapshot, currentSnapshot) {
  const prev = previousSnapshot.followerScreenNames;
  const curr = currentSnapshot.followerScreenNames;

  const unfollowedScreenNames = [];
  const newFollowerScreenNames = [];
  let unchangedCount = 0;
  let i = 0;
  let j = 0;

  while (i < prev.length && j < curr.length) {
    if (prev[i] === curr[j]) {
      unchangedCount++;
      i++;
      j++;
    } else if (prev[i] < curr[j]) {
      unfollowedScreenNames.push(prev[i]);
      i++;
    } else {
      newFollowerScreenNames.push(curr[j]);
      j++;
    }
  }

  while (i < prev.length) {
    unfollowedScreenNames.push(prev[i]);
    i++;
  }

  while (j < curr.length) {
    newFollowerScreenNames.push(curr[j]);
    j++;
  }

  return { unfollowedScreenNames, newFollowerScreenNames, unchangedCount };
}

export function computeSnapshotFromFollowers(ownerScreenName, followers) {
  return {
    timestamp: Date.now(),
    ownerScreenName,
    followerCount: followers.length,
    followerScreenNames: followers.map((f) => f.screenName.toLowerCase()).sort(),
  };
}
