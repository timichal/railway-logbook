/**
 * What the web app keeps behind its hamburger: the region, the colour scheme, who is
 * signed in, and the way out. The layer switches and the articles follow with the map
 * and the features they belong to.
 */

import { REGIONS, type RegionId } from "@shared/regions";
import { type ReactNode, useMemo } from "react";
import { ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { API_ORIGIN } from "@/config";
import { useRegion } from "@/region/RegionContext";
import { type ThemePreference, useTheme } from "@/theme/ThemeContext";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { value: ThemePreference; label: string }[];

export default function SettingsScreen(): ReactNode {
  const { user, signOut } = useAuth();
  const { regionId, setRegion } = useRegion();
  const { preference, setPreference } = useTheme();

  const regionOptions = useMemo(
    () =>
      Object.values(REGIONS).map((region) => ({
        value: region.id,
        label: `${region.flag} ${region.label}`,
      })),
    [],
  );

  return (
    <Screen edges={["top"]}>
      <ScrollView contentContainerClassName="gap-8 p-6">
        <View className="gap-1">
          <Text className="text-2xl font-bold text-gray-900 dark:text-gray-100">Settings</Text>
          <Text className="text-sm text-gray-600 dark:text-gray-400">
            Signed in as {user?.name ?? user?.email}
          </Text>
        </View>

        <Section title="Region" hint="Which network the map and your numbers cover.">
          <SegmentedControl<RegionId>
            options={regionOptions}
            value={regionId}
            onChange={setRegion}
          />
        </Section>

        <Section title="Appearance">
          <SegmentedControl<ThemePreference>
            options={THEME_OPTIONS}
            value={preference}
            onChange={setPreference}
          />
        </Section>

        <Section title="Account">
          <Button label="Log out" variant="danger" onPress={() => void signOut()} />
        </Section>

        <Text className="text-center text-xs text-gray-400 dark:text-gray-500">{API_ORIGIN}</Text>
      </ScrollView>
    </Screen>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <View className="gap-3">
      <View className="gap-0.5">
        <Text className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</Text>
        {hint ? <Text className="text-sm text-gray-600 dark:text-gray-400">{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}
