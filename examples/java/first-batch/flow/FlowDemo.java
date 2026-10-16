public class FlowDemo {
    public static void main(String[] args) {
        int[] costs = {0, 10, -1, 20, 50};
        int budget = 30;
        int selected = 0;
        int total = 0;

        for (int i = 0; i < costs.length; i++) {
            int cost = costs[i];
            if (cost <= 0) {
                continue;
            }
            if (total + cost > budget) {
                continue;
            }
            total += cost;
            selected++;
        }

        String state = switch (selected) {
            case 0 -> "EMPTY";
            case 1 -> "ONE";
            default -> "BATCH";
        };
        System.out.println("selected=" + selected);
        System.out.println("total=" + total);
        System.out.println("state=" + state);
        System.out.println("empty=" + (new int[0].length == 0));
    }
}
