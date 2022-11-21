enum player_state_category {
  GROUND_ONLY,
  AIR_ONLY,
  GROUND_OR_AIR
};

type UAttackData = {
  m_groundedness: string;
};