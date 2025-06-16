export const enum Version {
    AC1001, // pre-2.5
    AC1002, // 2.5
    AC1003, // 2.6
    AC1004, // ffR09
    AC1005, // pre-R10
    AC1006, // ffR10,
    AC1007, // pre-R11
    AC1008, // pre-R11
    AC1009, // 11/12 (or LT R1/R2)
    AC1010, // pre-R13a
    AC1011, // pre-R13b
    AC1012, // 13 (or LT95)
    AC1013, // pre-R14
    AC1014, // 14, 14.01 (or LT97/LT98)
    AC1500, // pre-2000,
    AC1015, // 2000/2000i/2002
    AC402a, // pre-2004a
    AC402b, // pre-2004b
    AC1018, // 2004/2005/2006
    AC1021,
    AC1024,
    AC1027,
    AC1032,
}

export const VersionMap: Record<string, Version> = {
    "AC1001": Version.AC1001,
    "AC1002": Version.AC1002,
    "AC1003": Version.AC1003,
    "AC1004": Version.AC1004,
    "AC1005": Version.AC1005,
    "AC1006": Version.AC1006,
    "AC1007": Version.AC1007,
    "AC1008": Version.AC1008,
    "AC1009": Version.AC1009,
    "AC1010": Version.AC1010,
    "AC1011": Version.AC1011,
    "AC1012": Version.AC1012,
    "AC1013": Version.AC1013,
    "AC1014": Version.AC1014,
    "AC1500": Version.AC1500,
    "AC1015": Version.AC1015,
    "AC402a": Version.AC402a,
    "AC402b": Version.AC402b,
    "AC1018": Version.AC1018,
    "AC1021": Version.AC1021,
    "AC1024": Version.AC1024,
    "AC1027": Version.AC1027,
    "AC1032": Version.AC1032,
}