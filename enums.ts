export enum Usage {
  Regular, // Pravidelný provoz
  OnceDaily, // Provoz jednou denně
  Seasonal, // Sezónní provoz
  OnceWeekly, // Provoz jednou týdně
  Weekdays, // Provoz o pracovních dnech
  Weekends, // Provoz o víkendech
  Special, // Provoz při zvláštních příležitostech
}

export enum Operator {
  // Česko
  ČD = "České dráhy",
  GW = "GW Train Regio",
  RC = "Railway Capital",
  DLB = "Die Länderbahn",
  RJ = "RegioJet",
  AR = "Arriva",
  MPD = "Mladějovská průmyslová dráha",
  MBM = "MBM Rail",
  VL = "Vltavotýnská lokálka",
  KŽC = "KŽC Doprava",
  AŽD = "AŽD Praha",
}
