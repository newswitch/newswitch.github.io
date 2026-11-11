import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;

public class TextDemo {
    public static void main(String[] args) {
        String text = "A\uD83D\uDE00中";
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        System.out.println("units=" + text.length());
        System.out.println("points=" + text.codePointCount(0, text.length()));
        System.out.println("utf8Bytes=" + bytes.length);
        System.out.println("roundTrip=" + text.equals(new String(bytes, StandardCharsets.UTF_8)));
        String decomposed = "e\u0301";
        String composed = "\u00e9";
        System.out.println("rawEqual=" + decomposed.equals(composed));
        System.out.println("normalized=" + Normalizer.normalize(decomposed, Normalizer.Form.NFC).equals(composed));
        var matcher = Pattern.compile("task-(\\d+)").matcher("task-42");
        System.out.println("matches=" + matcher.matches());
        System.out.println("id=" + matcher.group(1));
        System.out.println("split=" + Arrays.toString("a,b,".split(",", -1)));
        System.out.println("lower=" + "READY".toLowerCase(Locale.ROOT));
    }
}
